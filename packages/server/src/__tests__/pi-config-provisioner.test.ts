import { describe, it, expect } from "vitest";
import {
  renderModelsJson,
  renderProviderEntry,
  providerEntryFromEnv,
} from "../infra/pi-config-provisioner.js";
import { parseModelList } from "../infra/model-catalog.js";
import type { ProviderConfig } from "../core/types.js";

function provider(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "qwencloud",
    enabled: true,
    api: "anthropic-messages",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
    ...overrides,
  };
}

describe("renderProviderEntry", () => {
  it("renders a qwencloud models.json entry with env interpolation", () => {
    const entry = renderProviderEntry(
      provider({
        models: ["qwen3.8-max", "deepseek-v4-pro"],
        secretFile: "provider-qwencloud.yaml",
      })
    );
    expect(entry).toEqual({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      apiKey: "$QWENCLOUD_API_KEY",
      models: [{ id: "qwen3.8-max" }, { id: "deepseek-v4-pro" }],
    });
  });

  it("omits apiKey for a keyless provider", () => {
    const entry = renderProviderEntry(provider({ models: ["llama3"] }));
    expect(entry).toEqual({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      models: [{ id: "llama3" }],
    });
  });
});

describe("renderModelsJson", () => {
  it("merges multiple providers into one models.json", () => {
    const a = provider({
      id: "stub",
      api: "openai-completions",
      baseUrl: "http://stub:8080/v1",
      secretFile: "provider-stub.yaml",
    });
    const b = provider({
      id: "stub2",
      api: "openai-completions",
      baseUrl: "http://stub2:8080/v1",
      secretFile: "provider-stub2.yaml",
    });
    const json = renderModelsJson([a, b]);
    const providers = json.providers as Record<string, Record<string, unknown>>;
    expect(Object.keys(providers).sort()).toEqual(["stub", "stub2"]);
    expect(providers.stub.apiKey).toBe("$STUB_API_KEY");
    expect(providers.stub2.apiKey).toBe("$STUB2_API_KEY");
  });
});

describe("providerEntryFromEnv", () => {
  it("builds an oauth auth.json entry", () => {
    const p = provider({ id: "github-copilot" });
    const entry = providerEntryFromEnv(
      p,
      new Map([
        ["access", "copilot-token"],
        ["refresh", "ghu_refresh"],
        ["expires", "1750000000000"],
      ])
    );
    expect(entry).toEqual({
      type: "oauth",
      access: "copilot-token",
      refresh: "ghu_refresh",
      expires: 1750000000000,
    });
  });

  it("returns null without both access and refresh", () => {
    const p = provider({});
    expect(providerEntryFromEnv(p, new Map([["access", "x"]]))).toBeNull();
  });
});

describe("parseModelList", () => {
  it("parses an OpenAI-style data[].id response", () => {
    expect(parseModelList({ data: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
  });

  it("parses a models[].id response", () => {
    expect(parseModelList({ models: [{ id: "x" }, { id: "y" }] })).toEqual(["x", "y"]);
  });

  it("ignores non-object or non-id entries", () => {
    expect(parseModelList({ data: ["plain", { id: "z" }, 42] })).toEqual(["plain", "z"]);
  });

  it("returns empty for unrelated shapes", () => {
    expect(parseModelList({ not: "models" })).toEqual([]);
  });
});