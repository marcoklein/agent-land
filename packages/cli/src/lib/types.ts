export interface MessageBlock {
  type: string;
  text?: string;
}

export interface Message {
  role?: string;
  content?: MessageBlock[];
  stopReason?: string;
  errorMessage?: string;
}

export interface AgentEvent {
  type: string;
  seq?: number;
  status?: string;
  text?: string;
  message?: Message | null;
  requestId?: string;
  method?: string;
  prompt?: string;
  options?: string[];
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export interface RenderLine {
  kind: string;
  text: string;
}

export interface SseEvent {
  event?: string;
  data?: string;
}

export interface SessionSummary {
  id: string;
  status: string;
  createdAt: string;
  model: string;
  provider?: string;
  workspace?: { repoUrl: string; ref?: string };
  connectors?: string[];
}

export interface ConnectorSummary {
  name: string;
  type: string;
  url: string;
}

export interface ProviderSummary {
  id: string;
  kind: string;
  label?: string;
  api?: string;
  enabled: boolean;
  defaultModel?: string;
}

export interface ConnectorFieldDef {
  envVar: string;
  label: string;
}

export interface Dialog {
  requestId: string;
  method: string;
  options?: string[];
  prompt?: string;
}

export interface RunResult {
  settled: boolean;
  stopped: boolean;
  timedOut: boolean;
  finalMessage: string;
  error?: string;
}

export interface Config {
  url: string;
  authHeader?: string;
}
