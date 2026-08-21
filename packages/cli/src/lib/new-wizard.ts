import type { ApiClient } from "./api.js";
import type { ConnectorSummary, ProviderSummary } from "./types.js";

export const DEFAULT_PROVIDER_ID = "opencode-go";

export interface SelectOption {
  value: string;
  label: string;
}

export interface PromptIO {
  select(options: SelectOption[], prompt: string, opts?: { multiple?: boolean }): Promise<string[]>;
  text(prompt: string): Promise<string>;
}

export interface NewOptions {
  provider?: string;
  model?: string;
  connectors: string[];
}

export interface NewChoices {
  provider?: string;
  model?: string;
  connectors?: string[];
}

export async function gatherChoices(
  client: ApiClient,
  opts: NewOptions,
  io: PromptIO
): Promise<NewChoices> {
  let provider = opts.provider;

  if (!provider && !opts.model) {
    provider = await chooseProvider(client, io);
  }

  let model = opts.model;
  if (!model) {
    model = await chooseModel(client, io, provider ?? DEFAULT_PROVIDER_ID);
  }

  let connectors = opts.connectors.length > 0 ? opts.connectors : undefined;
  if (!connectors) {
    connectors = await chooseConnectors(client, io);
  }

  const choices: NewChoices = {};
  if (provider && provider !== DEFAULT_PROVIDER_ID) choices.provider = provider;
  if (model) choices.model = model;
  if (connectors && connectors.length > 0) choices.connectors = connectors;
  return choices;
}

async function chooseProvider(client: ApiClient, io: PromptIO): Promise<string> {
  const { providers } = (await client.listProviders()) as { providers?: ProviderSummary[] };
  const others = (providers ?? []).filter((p) => p.enabled && p.id !== DEFAULT_PROVIDER_ID);

  if (others.length === 0) return DEFAULT_PROVIDER_ID;

  const options: SelectOption[] = [
    { value: DEFAULT_PROVIDER_ID, label: "OpenCode Go (default)" },
    ...others.map((p) => ({ value: p.id, label: p.label || p.id })),
  ];

  const [chosen] = await io.select(options, "provider> ");
  return chosen ?? DEFAULT_PROVIDER_ID;
}

async function chooseModel(
  client: ApiClient,
  io: PromptIO,
  provider: string
): Promise<string | undefined> {
  let models: string[] = [];
  try {
    const res = (await client.listModels(provider)) as { models?: string[] };
    models = res.models ?? [];
  } catch {
    models = [];
  }

  if (models.length > 0) {
    const options = models.map((m) => ({ value: m, label: m }));
    const [chosen] = await io.select(options, "model> ");
    return chosen;
  }

  const fallback = await defaultModelFor(client, provider);
  const answer = await io.text(
    fallback ? `model (default: ${fallback})> ` : "model> "
  );
  const trimmed = answer.trim();
  if (trimmed) return trimmed;
  return fallback;
}

async function defaultModelFor(
  client: ApiClient,
  provider: string
): Promise<string | undefined> {
  try {
    const { providers } = (await client.listProviders()) as { providers?: ProviderSummary[] };
    return (providers ?? []).find((p) => p.id === provider)?.defaultModel;
  } catch {
    return undefined;
  }
}

async function chooseConnectors(client: ApiClient, io: PromptIO): Promise<string[]> {
  let connectors: ConnectorSummary[] = [];
  try {
    const res = (await client.listConnectors()) as { connectors?: ConnectorSummary[] };
    connectors = res.connectors ?? [];
  } catch {
    connectors = [];
  }

  if (connectors.length === 0) return [];

  const options: SelectOption[] = [
    { value: "", label: "none" },
    ...connectors.map((c) => ({ value: c.name, label: `${c.name} (${c.type})` })),
  ];

  const chosen = await io.select(options, "connectors (comma-separated)> ", { multiple: true });
  return chosen.filter(Boolean);
}
