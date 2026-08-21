export type PermissionPolicy = "auto" | "manual";

export type SessionStatus = "running" | "waiting_for_input" | "idle" | "stopped";

export type ProviderKind = "builtin" | "custom" | "oauth";

export const DEFAULT_PROVIDER_ID = "opencode-go";

export type ProviderApiType =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  piProvider: string;
  label?: string;
  baseUrl?: string;
  api?: ProviderApiType;
  models?: string[];
  defaultModel?: string;
  secretFile?: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentSession {
  id: string;
  status: SessionStatus;
  permissionPolicy: PermissionPolicy;
  sessionDir: string;
  connectors: string[];
  model: string;
  provider?: string;
  createdAt: string;
  updatedAt: string;
  containerId?: string;
  waitingFor?: {
    requestId: string;
    method: "confirm" | "input" | "select" | "editor";
    prompt?: string;
  };
}

export interface Connector {
  name: string;
  type: "jira" | "github" | "gmail" | "custom";
  url: string;
  secretFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretInfo {
  name: string;
  filename: string;
  size: number;
  modifiedAt: string;
}

export interface DecryptedSecret {
  name: string;
  content: string;
}
