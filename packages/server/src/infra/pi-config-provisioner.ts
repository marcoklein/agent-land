import type { DockerPort, ProviderRepository, SecretsPort } from "../core/ports.js";
import type { AgentSession, ProviderConfig } from "../core/types.js";
import { DEFAULT_PROVIDER_ID } from "../core/types.js";
import { customProviderEnvVar } from "../core/provider-service.js";

export const PI_CONFIG_DIR = "/tmp/pi-config";

export class PiConfigProvisioner {
  constructor(
    private docker: DockerPort,
    private providers: ProviderRepository,
    private secrets: SecretsPort
  ) {}

  async provision(session: AgentSession, containerId: string): Promise<void> {
    const all = await this.providers.list();
    const enabled = all.filter((p) => p.enabled);
    const selectedId = session.provider ?? DEFAULT_PROVIDER_ID;
    const selected = enabled.find((p) => p.id === selectedId) ?? null;

    const customs = enabled.filter((p) => p.kind === "custom");
    if (customs.length > 0) {
      const modelsJson = renderModelsJson(customs);
      await this.docker.writeFile(
        containerId,
        `${PI_CONFIG_DIR}/models.json`,
        JSON.stringify(modelsJson, null, 2) + "\n",
        0o644
      );
    }

    if (selected?.kind === "oauth") {
      const authJson = await this.renderAuthJson(selected);
      if (authJson) {
        await this.docker.writeFile(
          containerId,
          `${PI_CONFIG_DIR}/auth.json`,
          JSON.stringify(authJson, null, 2) + "\n",
          0o600
        );
      }
    }
  }

  private async renderAuthJson(provider: ProviderConfig): Promise<Record<string, unknown> | null> {
    if (!provider.secretFile) return null;
    const name = provider.secretFile.replace(/\.(ya?ml)$/, "");
    const exists = await this.secrets.secretExists(name).catch(() => false);
    if (!exists) return null;

    try {
      const env = await this.secrets.decryptMultiple([provider.secretFile]);
      const entry = oauthEntryFromEnv(provider, env);
      if (!entry) return null;
      return { [provider.piProvider]: entry };
    } catch {
      return null;
    }
  }
}

export function renderModelsJson(customs: ProviderConfig[]): Record<string, unknown> {
  const providers: Record<string, unknown> = {};
  for (const provider of customs) {
    providers[provider.id] = renderCustomProviderEntry(provider);
  }
  return { providers };
}

export function renderCustomProviderEntry(provider: ProviderConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (provider.baseUrl) {
    entry.baseUrl = normalizeBaseUrl(provider);
  }
  if (provider.api) {
    entry.api = provider.api;
  }

  entry.apiKey = `$${customProviderEnvVar(provider.id)}`;

  if (provider.models && provider.models.length > 0) {
    entry.models = provider.models.map((id) => ({ id }));
  }

  return entry;
}

export function normalizeBaseUrl(provider: ProviderConfig): string {
  const base = trimSlash(provider.baseUrl ?? "");
  switch (provider.api) {
    case "anthropic-messages":
      return stripTrailingSegment(base, "v1");
    case "openai-completions":
    case "openai-responses":
      return base.endsWith("/v1") ? base : `${base}/v1`;
    default:
      return base;
  }
}

export function oauthEntryFromEnv(
  provider: ProviderConfig,
  env: Map<string, string>
): { type: "oauth"; access: string; refresh: string; expires?: number } | null {
  const access = env.get("access") ?? env.get("ACCESS");
  const refresh = env.get("refresh") ?? env.get("REFRESH");
  if (!access || !refresh) return null;

  const entry: { type: "oauth"; access: string; refresh: string; expires?: number } = {
    type: "oauth",
    access,
    refresh,
  };

  const expiresRaw = env.get("expires") ?? env.get("EXPIRES");
  if (expiresRaw) {
    const expires = Number(expiresRaw);
    if (Number.isFinite(expires)) entry.expires = expires;
  }
  return entry;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function stripTrailingSegment(url: string, segment: string): string {
  const suffix = `/${segment}`;
  return url.endsWith(suffix) ? url.slice(0, -suffix.length) : url;
}
