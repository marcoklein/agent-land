import type { DockerPort, ProviderRepository, SecretsPort } from "../core/ports.js";
import type { AgentSession, ProviderConfig } from "../core/types.js";
import { DEFAULT_PROVIDER_ID } from "../core/types.js";

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

    if (enabled.length > 0) {
      const modelsJson = renderModelsJson(enabled);
      await this.docker.writeFile(
        containerId,
        `${PI_CONFIG_DIR}/models.json`,
        JSON.stringify(modelsJson, null, 2) + "\n",
        0o644
      );
    }

    if (selected) {
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
    if (!exists) {
      if (provider.id === DEFAULT_PROVIDER_ID) {
        return { apiKey: "$OPENCODE_API_KEY", baseUrl: "$OPENCODE_API_URL" };
      }
      return null;
    }

    try {
      const env = await this.secrets.decryptMultiple([provider.secretFile]);
      const entry = providerEntryFromEnv(provider, env);
      if (!entry) return null;
      return { [provider.id]: entry };
    } catch {
      return null;
    }
  }
}

export function renderModelsJson(providers: ProviderConfig[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const provider of providers) {
    result[provider.id] = renderProviderEntry(provider);
  }
  return { providers: result };
}

export function renderProviderEntry(provider: ProviderConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (provider.baseUrl) {
    entry.baseUrl = provider.baseUrl;
  }
  if (provider.api) {
    entry.api = provider.api;
  }

  if (provider.secretFile) {
    entry.apiKey = `$${provider.id.toUpperCase()}_API_KEY`;
  }

  if (provider.models && provider.models.length > 0) {
    entry.models = provider.models.map((id) => ({ id }));
  }

  return entry;
}

export function providerEntryFromEnv(
  provider: ProviderConfig,
  env: Map<string, string>
): Record<string, unknown> | null {
  const access = env.get("access") ?? env.get("ACCESS");
  const refresh = env.get("refresh") ?? env.get("REFRESH");
  if (access && refresh) {
    const entry: Record<string, unknown> = {
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

  const apiKey = env.get(`${provider.id.toUpperCase()}_API_KEY`);
  if (apiKey) {
    const entry: Record<string, unknown> = { apiKey };
    if (provider.baseUrl) entry.baseUrl = provider.baseUrl;
    if (provider.api) entry.api = provider.api;
    if (provider.models && provider.models.length > 0) {
      entry.models = provider.models.map((id) => ({ id }));
    }
    return entry;
  }

  return null;
}