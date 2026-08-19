import type { ProviderApiType } from "./types.js";

export type CatalogAuth = "bearer" | "x-api-key" | "none" | "oauth";

export interface CatalogEntry {
  id: string;
  kind: "builtin" | "oauth";
  label?: string;
  authEnvVars?: string[];
  modelsApi?: { url: string; auth: CatalogAuth };
  api?: ProviderApiType;
  baseUrl?: string;
  defaultModel?: string;
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  {
    id: "opencode-go",
    kind: "builtin",
    label: "OpenCode Go",
    authEnvVars: ["OPENCODE_API_KEY", "OPENCODE_API_URL"],
    modelsApi: { url: "https://opencode.ai/zen/go/v1/models", auth: "none" },
    defaultModel: "deepseek-v4-pro",
  },
  {
    id: "opencode",
    kind: "builtin",
    label: "OpenCode Zen",
    authEnvVars: ["OPENCODE_API_KEY"],
    modelsApi: { url: "https://opencode.ai/zen/v1/models", auth: "none" },
  },
  {
    id: "mistral",
    kind: "builtin",
    label: "Mistral",
    authEnvVars: ["MISTRAL_API_KEY"],
    modelsApi: { url: "https://api.mistral.ai/v1/models", auth: "bearer" },
    defaultModel: "mistral-large-latest",
  },
  {
    id: "deepseek",
    kind: "builtin",
    label: "DeepSeek",
    authEnvVars: ["DEEPSEEK_API_KEY"],
    modelsApi: { url: "https://api.deepseek.com/v1/models", auth: "bearer" },
    defaultModel: "deepseek-chat",
  },
  {
    id: "anthropic",
    kind: "builtin",
    label: "Anthropic",
    authEnvVars: ["ANTHROPIC_API_KEY"],
    modelsApi: { url: "https://api.anthropic.com/v1/models?limit=1000", auth: "x-api-key" },
    defaultModel: "claude-sonnet-4-5",
  },
  {
    id: "openai",
    kind: "builtin",
    label: "OpenAI",
    authEnvVars: ["OPENAI_API_KEY"],
    modelsApi: { url: "https://api.openai.com/v1/models", auth: "bearer" },
    defaultModel: "gpt-5",
  },
  {
    id: "groq",
    kind: "builtin",
    label: "Groq",
    authEnvVars: ["GROQ_API_KEY"],
    modelsApi: { url: "https://api.groq.com/openai/v1/models", auth: "bearer" },
    defaultModel: "llama-3.3-70b-versatile",
  },
  {
    id: "xai",
    kind: "builtin",
    label: "xAI",
    authEnvVars: ["XAI_API_KEY"],
    modelsApi: { url: "https://api.x.ai/v1/models", auth: "bearer" },
    defaultModel: "grok-4",
  },
  {
    id: "openrouter",
    kind: "builtin",
    label: "OpenRouter",
    authEnvVars: ["OPENROUTER_API_KEY"],
    modelsApi: { url: "https://openrouter.ai/api/v1/models", auth: "bearer" },
  },
  {
    id: "qwen-token-plan",
    kind: "builtin",
    label: "QwenCloud Token Plan",
    authEnvVars: ["QWEN_TOKEN_PLAN_API_KEY"],
    api: "anthropic-messages",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
  },
  {
    id: "github-copilot",
    kind: "oauth",
    label: "GitHub Copilot",
    defaultModel: "claude-haiku-4.5",
  },
];

const CATALOG_BY_ID = new Map(PROVIDER_CATALOG.map((entry) => [entry.id, entry]));

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG_BY_ID.get(id);
}

export function isCatalogId(id: string): boolean {
  return CATALOG_BY_ID.has(id);
}
