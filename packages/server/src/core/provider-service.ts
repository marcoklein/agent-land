import type { ProviderConfig, ProviderKind, ProviderApiType } from "./types.js";
import type { SecretsPort, ProviderRepository } from "./ports.js";
import { getCatalogEntry, isCatalogId } from "./provider-catalog.js";
import { slugify } from "./connector-service.js";

export function providerSecretName(id: string): string {
  return `provider-${id}`;
}

export function customProviderEnvVar(id: string): string {
  return `${id.replace(/-/g, "_").toUpperCase()}_API_KEY`;
}

export class DuplicateProviderError extends Error {
  constructor(id: string) {
    super(`Provider "${id}" already exists.`);
    this.name = "DuplicateProviderError";
  }
}

export interface CreateProviderInput {
  id: string;
  kind: ProviderKind;
  baseUrl?: string;
  api?: ProviderApiType;
  models?: string[];
  defaultModel?: string;
  label?: string;
  enabled?: boolean;
  secretFields?: Record<string, string>;
  secretContent?: string;
}

const VALID_KINDS: ProviderKind[] = ["builtin", "custom", "oauth"];
const VALID_APIS: ProviderApiType[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

export class ProviderService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private repository: ProviderRepository,
    private secrets: SecretsPort
  ) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async list(): Promise<ProviderConfig[]> {
    const stored = await this.repository.list();
    return stored;
  }

  async listEnabled(): Promise<ProviderConfig[]> {
    const stored = await this.repository.list();
    return stored.filter((p) => p.enabled);
  }

  async get(id: string): Promise<ProviderConfig | null> {
    const stored = await this.repository.list();
    return stored.find((p) => p.id === id) ?? null;
  }

  create(input: CreateProviderInput): Promise<ProviderConfig> {
    return this.enqueue(() => this.doCreate(input));
  }

  delete(id: string): Promise<void> {
    return this.enqueue(() => this.doDelete(id));
  }

  setEnabled(id: string, enabled: boolean): Promise<ProviderConfig | null> {
    return this.enqueue(() => this.doSetEnabled(id, enabled));
  }

  private async doCreate(input: CreateProviderInput): Promise<ProviderConfig> {
    const slug = slugify(input.id);
    if (!slug) {
      throw new Error("Provider id must contain at least one letter or number.");
    }
    if (!VALID_KINDS.includes(input.kind)) {
      throw new Error(`Invalid provider kind "${input.kind}".`);
    }
    if (input.api !== undefined && !VALID_APIS.includes(input.api)) {
      throw new Error(`Invalid provider api "${input.api}".`);
    }

    const existing = await this.repository.list();
    if (existing.some((p) => p.id === slug)) {
      throw new DuplicateProviderError(slug);
    }

    if (input.kind === "builtin" && isCatalogId(slug)) {
      const catalog = getCatalogEntry(slug)!;
      const hasSecret = await this.hasSecretMaterial(input);
      if (!hasSecret && slug !== "opencode-go") {
        throw new Error(`Built-in provider "${slug}" requires credentials.`);
      }
      const config: ProviderConfig = {
        id: slug,
        kind: "builtin",
        piProvider: catalog.id,
        label: input.label ?? catalog.label,
        defaultModel: input.defaultModel ?? catalog.defaultModel,
        enabled: input.enabled ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (hasSecret) {
        await this.saveSecret(slug, input);
        config.secretFile = `provider-${slug}.yaml`;
      }
      existing.push(config);
      await this.repository.save(existing);
      return config;
    }

    if (input.kind === "custom") {
      if (!input.baseUrl) {
        throw new Error("Custom provider requires a baseUrl.");
      }
      if (!input.api) {
        throw new Error("Custom provider requires an api type.");
      }
      const models = normalizeModels(input.models);
      const config: ProviderConfig = {
        id: slug,
        kind: "custom",
        piProvider: slug,
        label: input.label,
        baseUrl: input.baseUrl,
        api: input.api,
        models: models.length > 0 ? models : undefined,
        defaultModel: input.defaultModel ?? models[0],
        secretFile: `provider-${slug}.yaml`,
        enabled: input.enabled ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (await this.hasSecretMaterial(input)) {
        await this.saveSecret(slug, input);
      } else {
        config.secretFile = undefined;
      }
      existing.push(config);
      await this.repository.save(existing);
      return config;
    }

    if (input.kind === "oauth") {
      const catalog = getCatalogEntry(slug);
      const config: ProviderConfig = {
        id: slug,
        kind: "oauth",
        piProvider: catalog?.id ?? slug,
        label: input.label ?? catalog?.label,
        defaultModel: input.defaultModel ?? catalog?.defaultModel,
        enabled: input.enabled ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (await this.hasSecretMaterial(input)) {
        await this.saveSecret(slug, input);
        config.secretFile = `provider-${slug}.yaml`;
      }
      existing.push(config);
      await this.repository.save(existing);
      return config;
    }

    if (input.kind === "builtin") {
      throw new Error(`Unknown built-in provider "${slug}". Pick one from the catalog.`);
    }

    throw new Error("Could not create provider.");
  }

  private async doDelete(id: string): Promise<void> {
    const stored = await this.repository.list();
    const provider = stored.find((p) => p.id === id);
    const filtered = stored.filter((p) => p.id !== id);
    await this.repository.save(filtered);

    if (provider?.secretFile) {
      await this.secrets
        .deleteSecret(provider.secretFile.replace(/\.(ya?ml)$/, ""))
        .catch(() => {});
    }
  }

  private async doSetEnabled(id: string, enabled: boolean): Promise<ProviderConfig | null> {
    const stored = await this.repository.list();
    const provider = stored.find((p) => p.id === id);
    if (!provider) return null;
    provider.enabled = enabled;
    provider.updatedAt = new Date().toISOString();
    await this.repository.save(stored);
    return provider;
  }

  private async hasSecretMaterial(input: CreateProviderInput): Promise<boolean> {
    if (input.secretContent && input.secretContent.trim().length > 0) return true;
    if (input.secretFields) {
      return Object.values(input.secretFields).some((v) => typeof v === "string" && v.trim().length > 0);
    }
    return false;
  }

  private async saveSecret(id: string, input: CreateProviderInput): Promise<void> {
    const yaml = buildSecretYaml(input);
    await this.secrets.saveEncrypted(providerSecretName(id), yaml);
  }
}

function normalizeModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter((m) => m.length > 0);
}

function buildSecretYaml(input: CreateProviderInput): string {
  if (input.secretContent && input.secretContent.trim().length > 0) {
    return input.secretContent;
  }
  const fields = input.secretFields ?? {};
  const lines = Object.entries(fields)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => `${key}: ${escapeYamlScalar(value)}`);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

function escapeYamlScalar(value: string): string {
  return JSON.stringify(value);
}
