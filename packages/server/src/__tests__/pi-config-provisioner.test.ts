import { describe, it, expect } from "vitest";
import {
  normalizeBaseUrl,
  renderCustomProviderEntry,
  renderModelsJson,
  oauthEntryFromEnv,
} from "../infra/pi-config-provisioner.js";
import { parseModelList } from "../infra/model-catalog.js";
import type { ProviderConfig } from "../core/types.js";

function custom(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "qwencloud",
    kind: "custom",
    piProvider: "qwencloud",
    enabled: true,
    api: "anthropic-messages",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
    ...overrides,
  };
}

describe("normalizeBaseUrl", () => {
  it("strips a trailing /v1 for anthropic-messages", () => {
    const provider = custom({
      api: "anthropic-messages",
      baseUrl: "https://example.com/apps/anthropic/v1",
    });
    expect(normalizeBaseUrl(provider)).toBe("https://example.com/apps/anthropic");
  });

  it("keeps an anthropic baseUrl without /v1 unchanged", () => {
    expect(normalizeBaseUrl(custom({}))).toBe(
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic"
    );
  });

  it("appends /v1 to an openai-completions baseUrl missing it", () => {
    const provider = custom({ api: "openai-completions", baseUrl: "http://host:11434" });
    expect(normalizeBaseUrl(provider)).toBe("http://host:11434/v1");
  });

  it("keeps an openai-responses baseUrl already ending in /v1", () => {
    const provider = custom({ api: "openai-responses", baseUrl: "https://opencode.ai/zen/v1" });
    expect(normalizeBaseUrl(provider)).toBe("https://opencode.ai/zen/v1");
  });
});

describe("renderCustomProviderEntry", () => {
  it("renders a validated qwencloud models.json entry with env interpolation", () => {
    const entry = renderCustomProviderEntry(
      custom({ models: ["qwen3.8-max", "deepseek-v4-pro"] })
    );
    expect(entry).toEqual({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      apiKey: "$QWENCLOUD_API_KEY",
      models: [{ id: "qwen3.8-max" }, { id: "deepseek-v4-pro" }],
    });
  });
});

describe("renderModelsJson", () => {
  it("merges multiple custom providers into one models.json", () => {
    const a = custom({ id: "stub", api: "openai-completions", baseUrl: "http://stub:8080/v1" });
    const b = custom({ id: "stub2", api: "openai-completions", baseUrl: "http://stub2:8080/v1" });
    const json = renderModelsJson([a, b]);
    const providers = json.providers as Record<string, Record<string, unknown>>;
    expect(Object.keys(providers).sort()).toEqual(["stub", "stub2"]);
    expect(providers.stub.apiKey).toBe("$STUB_API_KEY");
    expect(providers.stub2.apiKey).toBe("$STUB2_API_KEY");
  });
});

describe("oauthEntryFromEnv", () => {
  it("builds a github-copilot auth.json entry", () => {
    const provider = custom({ id: "github-copilot", kind: "oauth", piProvider: "github-copilot" });
    const entry = oauthEntryFromEnv(
      provider,
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
    const provider = custom({ kind: "oauth" });
    expect(oauthEntryFromEnv(provider, new Map([["access", "x"]]))).toBeNull();
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
