import { describe, it, expect } from "vitest";
import { SessionService } from "../core/session-service.js";
import { getConfig } from "../config.js";
import type { Config } from "../config.js";
import type { Connector } from "../core/types.js";
import type {
  ConnectorRepository,
  ProviderRepository,
  SecretsPort,
} from "../core/ports.js";

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    name: "github",
    envKeys: [],
    secretFile: "github.yaml",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeService(
  config: Config,
  opts: { connectors?: Connector[]; secretEnv?: Map<string, string> } = {}
): SessionService {
  const connectors: ConnectorRepository = {
    list: async () => opts.connectors ?? [],
    save: async () => {},
  };
  const secrets: SecretsPort = {
    decrypt: async () => ({ name: "", content: "" }),
    decryptMultiple: async () => opts.secretEnv ?? new Map(),
    encrypt: async () => "",
    saveEncrypted: async () => {},
    listSecrets: async () => [],
    deleteSecret: async () => {},
    secretExists: async () => false,
  };
  const providers: ProviderRepository = {
    list: async () => [],
    get: async () => null,
    save: async () => {},
  };

  return new SessionService({
    docker: {} as never,
    secrets,
    sessions: {} as never,
    connectors,
    providers,
    mounts: {} as never,
    harness: {} as never,
    eventLog: {} as never,
    config,
  });
}

function configWith(gitUserName: string, gitUserEmail: string): Config {
  return { ...getConfig(), gitUserName, gitUserEmail };
}

describe("resolveAgentEnv git identity injection", () => {
  it("injects git identity when configured", async () => {
    const service = makeService(configWith("Jane Doe", "jane@example.com"));

    const env = await service.resolveAgentEnv([]);

    expect(env.get("GIT_USER_NAME")).toBe("Jane Doe");
    expect(env.get("GIT_USER_EMAIL")).toBe("jane@example.com");
  });

  it("skips injection when git identity is unset", async () => {
    const service = makeService(configWith("", ""));

    const env = await service.resolveAgentEnv([]);

    expect(env.has("GIT_USER_NAME")).toBe(false);
    expect(env.has("GIT_USER_EMAIL")).toBe(false);
  });

  it("lets connector-provided values win over config", async () => {
    const connectorEnv = new Map([
      ["GIT_USER_NAME", "Connector Name"],
      ["GIT_USER_EMAIL", "connector@example.com"],
    ]);
    const service = makeService(configWith("Config Name", "config@example.com"), {
      connectors: [makeConnector()],
      secretEnv: connectorEnv,
    });

    const env = await service.resolveAgentEnv(["github"]);

    expect(env.get("GIT_USER_NAME")).toBe("Connector Name");
    expect(env.get("GIT_USER_EMAIL")).toBe("connector@example.com");
  });
});
