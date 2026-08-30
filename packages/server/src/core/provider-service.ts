import type { ProviderConfig } from "./types.js";
import type { SecretsPort, ProviderRepository } from "./ports.js";
import { slugify } from "./connector-service.js";

export function providerSecretName(id: string): string {
  return `provider-${id}`;
}

export class DuplicateProviderError extends Error {
  constructor(id: string) {
    super(`Provider "${id}" already exists.`);
    this.name = "DuplicateProviderError";
  }
}

export interface CreateProviderInput {
  id: string;
  label?: string;
  baseUrl?: string;
  api?: string;
  models?: string[];
  defaultModel?: string;
  enabled?: boolean;
  secretFields?: Record<string, string>;
  secretContent?: string;
  apiKey?: string;
}

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
    return this.repository.list();
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

  delete(id: string): Promise<boolean> {
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

    const existing = await this.repository.list();
    if (existing.some((p) => p.id === slug)) {
      throw new DuplicateProviderError(slug);
    }

    const models = normalizeModels(input.models);
    const hasSecret = await this.hasSecretMaterial(input);

    const config: ProviderConfig = {
      id: slug,
      label: input.label,
      baseUrl: input.baseUrl,
      api: input.api,
      models: models.length > 0 ? models : undefined,
      defaultModel: input.defaultModel ?? models[0],
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

  private async doDelete(id: string): Promise<boolean> {
    const stored = await this.repository.list();
    const provider = stored.find((p) => p.id === id);
    if (!provider) return false;

    const filtered = stored.filter((p) => p.id !== id);
    await this.repository.save(filtered);

    if (provider.secretFile) {
      await this.secrets
        .deleteSecret(provider.secretFile.replace(/\.(ya?ml)$/, ""))
        .catch(() => {});
    }
    return true;
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
    if (input.apiKey && input.apiKey.trim().length > 0) return true;
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
  if (input.apiKey && input.apiKey.trim().length > 0) {
    return `${input.id.toUpperCase()}_API_KEY: ${JSON.stringify(input.apiKey)}\n`;
  }
  const fields = input.secretFields ?? {};
  const lines = Object.entries(fields)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}