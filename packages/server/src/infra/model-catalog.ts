import type { SecretsPort } from "../core/ports.js";
import type { ProviderConfig } from "../core/types.js";
import { DEFAULT_PROVIDER_ID } from "../core/types.js";
import type { ProviderService } from "../core/provider-service.js";
import { customProviderEnvVar } from "../core/provider-service.js";
import { getCatalogEntry, PROVIDER_CATALOG, type CatalogEntry } from "../core/provider-catalog.js";
import { parseSecretYaml } from "./sops.js";

const CACHE_TTL_MS = 3600_000;
const FETCH_TIMEOUT_MS = 5000;

interface CacheEntry {
  models: string[];
  fetchedAt: number;
}

export class ModelCatalog {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<string[]>>();

  constructor(
    private providers: ProviderService,
    private secrets: SecretsPort
  ) {}

  async getModels(providerId: string = DEFAULT_PROVIDER_ID): Promise<string[]> {
    const cached = this.cache.get(providerId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return [...cached.models];
    }

    const existing = this.inFlight.get(providerId);
    if (existing) return existing;

    const fetch = this.fetch(providerId).finally(() => {
      this.inFlight.delete(providerId);
    });
    this.inFlight.set(providerId, fetch);
    return fetch;
  }

  private async fetch(providerId: string): Promise<string[]> {
    try {
      const models = await this.discover(providerId);
      this.cache.set(providerId, { models, fetchedAt: Date.now() });
      return [...models];
    } catch (err) {
      const cached = this.cache.get(providerId);
      if (cached) {
        console.warn(`Model discovery failed for "${providerId}": ${errMessage(err)}; using cached list`);
        return [...cached.models];
      }
      console.warn(`Model discovery failed for "${providerId}": ${errMessage(err)}`);
      return [];
    }
  }

  private async discover(providerId: string): Promise<string[]> {
    const provider = await this.providers.get(providerId);
    if (provider) {
      return this.discoverFromProvider(provider);
    }
    const catalog = getCatalogEntry(providerId);
    if (catalog) {
      return this.discoverFromCatalog(catalog, null);
    }
    return [];
  }

  private async discoverFromProvider(provider: ProviderConfig): Promise<string[]> {
    if (provider.models && provider.models.length > 0) {
      return [...provider.models];
    }

    if (provider.kind === "builtin") {
      const catalog = getCatalogEntry(provider.id);
      if (catalog) {
        return this.discoverFromCatalog(catalog, provider);
      }
    }

    if (provider.kind === "oauth") {
      return [];
    }

    return this.discoverCustom(provider);
  }

  private async discoverFromCatalog(catalog: CatalogEntry, provider: ProviderConfig | null): Promise<string[]> {
    if (!catalog.modelsApi) {
      return [];
    }
    const { url, auth } = catalog.modelsApi;

    const headers: Record<string, string> = {};
    if (auth === "bearer" || auth === "x-api-key") {
      const key = await this.resolveKey(provider, catalog);
      if (!key) return [];
      if (auth === "bearer") headers.Authorization = `Bearer ${key}`;
      else headers["x-api-key"] = key;
    }

    const body = await this.httpGet(url, headers);
    return parseModelList(body);
  }

  private async discoverCustom(provider: ProviderConfig): Promise<string[]> {
    if (!provider.baseUrl) return provider.models ?? [];

    const key = await this.resolveCustomKey(provider);
    const headers: Record<string, string> = {};
    let url: string;

    switch (provider.api) {
      case "anthropic-messages":
        url = `${trimSlash(provider.baseUrl)}/models`;
        if (key) headers["x-api-key"] = key;
        break;
      case "google-generative-ai":
        url = `${trimSlash(provider.baseUrl)}/models${key ? `?key=${encodeURIComponent(key)}` : ""}`;
        break;
      case "openai-completions":
      case "openai-responses":
      default:
        url = `${trimSlash(provider.baseUrl)}/models`;
        if (key) headers.Authorization = `Bearer ${key}`;
        break;
    }

    try {
      const body = await this.httpGet(url, headers);
      const models = parseModelList(body);
      if (models.length > 0) return models;
    } catch (err) {
      console.warn(`Custom provider "${provider.id}" discovery failed: ${errMessage(err)}; using static list`);
    }
    return provider.models ?? [];
  }

  private async resolveKey(provider: ProviderConfig | null, catalog: CatalogEntry): Promise<string | null> {
    if (!provider?.secretFile) return null;
    const envVar = this.builtinKeyEnvVar(catalog);
    return this.readSecretVar(provider.secretFile, envVar);
  }

  private async resolveCustomKey(provider: ProviderConfig): Promise<string | null> {
    if (!provider.secretFile) return null;
    return this.readSecretVar(provider.secretFile, customProviderEnvVar(provider.id));
  }

  private async readSecretVar(secretFile: string, envVar: string): Promise<string | null> {
    if (!envVar) return null;
    const name = secretFile.replace(/\.(ya?ml)$/, "");
    const exists = await this.secrets.secretExists(name).catch(() => false);
    if (!exists) return null;
    try {
      const { content } = await this.secrets.decrypt(secretFile);
      const envMap = parseSecretYaml(content);
      return envMap.get(envVar) ?? null;
    } catch {
      return null;
    }
  }

  private builtinKeyEnvVar(catalog: CatalogEntry): string {
    const vars = catalog.authEnvVars ?? [];
    return vars.find((v) => v.endsWith("_API_KEY")) ?? vars[0] ?? "";
  }

  private async httpGet(url: string, headers: Record<string, string>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function parseModelList(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;

  const openaiData = obj.data;
  if (Array.isArray(openaiData)) {
    return extractIds(openaiData);
  }
  if (Array.isArray(obj.models)) {
    return extractIds(obj.models);
  }
  return [];
}

function extractIds(items: unknown[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      ids.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const id = (item as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) ids.push(id);
    }
  }
  return ids;
}

export function listCatalogProviders(): CatalogEntry[] {
  return PROVIDER_CATALOG;
}
