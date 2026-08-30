import { describe, it, expect, vi } from "vitest";
import { gatherChoices, type PromptIO } from "./new-wizard.js";
import type { ApiClient } from "./api.js";
import type { ConnectorSummary, ProviderSummary } from "./types.js";

function makeClient(opts: {
  providers?: ProviderSummary[];
  models?: Record<string, string[]>;
  connectors?: ConnectorSummary[];
}): ApiClient {
  const providers = opts.providers ?? [];
  const models = opts.models ?? {};
  const connectors = opts.connectors ?? [];
  return {
    listProviders: async () => ({ providers }),
    listModels: async (provider?: string) => ({ models: models[provider ?? "opencode-go"] ?? [] }),
    listConnectors: async () => ({ connectors }),
  } as unknown as ApiClient;
}

function makeIO(opts: {
  select?: (...args: unknown[]) => Promise<string[]>;
  text?: (...args: unknown[]) => Promise<string>;
}): PromptIO {
  return {
    select: (opts.select as PromptIO["select"]) ?? (async () => []),
    text: (opts.text as PromptIO["text"]) ?? (async () => ""),
  };
}

describe("gatherChoices", () => {
  it("walks through provider, model and connectors interactively", async () => {
    const client = makeClient({
      providers: [{ id: "github-copilot", enabled: true, label: "GitHub Copilot" }],
      models: { "github-copilot": ["claude-haiku-4.5"] },
      connectors: [{ name: "jira", url: "https://jira" }],
    });
    const select = vi
      .fn()
      .mockResolvedValueOnce(["github-copilot"])
      .mockResolvedValueOnce(["claude-haiku-4.5"])
      .mockResolvedValueOnce(["jira"]);
    const io = makeIO({ select });

    const result = await gatherChoices(client, { connectors: [] }, io);

    expect(result).toEqual({
      provider: "github-copilot",
      model: "claude-haiku-4.5",
      connectors: ["jira"],
    });
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("skips provider and model prompts when a model flag is given", async () => {
    const client = makeClient({ connectors: [{ name: "jira", url: "u" }] });
    const select = vi.fn().mockResolvedValueOnce([]);
    const io = makeIO({ select });

    const result = await gatherChoices(client, { model: "m1", connectors: [] }, io);

    expect(result).toEqual({ model: "m1" });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("defaults to opencode-go without prompting when no other enabled provider exists", async () => {
    const client = makeClient({ models: { "opencode-go": ["deepseek-v4-pro"] } });
    const select = vi.fn().mockResolvedValueOnce(["deepseek-v4-pro"]);
    const io = makeIO({ select });

    const result = await gatherChoices(client, { connectors: [] }, io);

    expect(result).toEqual({ model: "deepseek-v4-pro" });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("falls back to the provider defaultModel when discovery returns no models", async () => {
    const client = makeClient({
      providers: [
        {
          id: "github-copilot",
          enabled: true,
          label: "GitHub Copilot",
          defaultModel: "claude-haiku-4.5",
        },
      ],
      models: { "github-copilot": [] },
    });
    const select = vi.fn().mockResolvedValueOnce(["github-copilot"]);
    const text = vi.fn().mockResolvedValueOnce("");
    const io = makeIO({ select, text });

    const result = await gatherChoices(client, { connectors: [] }, io);

    expect(result).toEqual({ provider: "github-copilot", model: "claude-haiku-4.5" });
  });

  it("returns no connectors when the user picks none", async () => {
    const client = makeClient({
      connectors: [{ name: "jira", url: "u" }],
    });
    const select = vi.fn().mockResolvedValueOnce([]);
    const io = makeIO({ select });

    const result = await gatherChoices(client, { model: "m1", connectors: [] }, io);

    expect(result).toEqual({ model: "m1" });
  });

  it("uses flag-provided values without prompting", async () => {
    const client = makeClient({});
    const select = vi.fn();
    const io = makeIO({ select });

    const result = await gatherChoices(
      client,
      { provider: "x", model: "m", connectors: ["jira"] },
      io
    );

    expect(result).toEqual({ provider: "x", model: "m", connectors: ["jira"] });
    expect(select).not.toHaveBeenCalled();
  });
});