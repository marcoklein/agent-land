export interface Connector {
  name: string;
  type: "jira" | "github" | "gmail" | "custom";
  url: string;
  secretFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface KillSwitch {
  timeoutSeconds: number | null;
  maxTokens: number | null;
  maxCost: number | null;
}

export const DEFAULT_KILL_SWITCH: KillSwitch = {
  timeoutSeconds: 3600,
  maxTokens: 100000,
  maxCost: 1,
};

export interface AgentRun {
  id: string;
  task: string;
  connectors: string[];
  model: string;
  status: "pending" | "running" | "completed" | "failed" | "killed";
  containerId: string | null;
  sessionFile: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  killReason?: string;
  killSwitch: KillSwitch;
  totalTokens?: number;
  totalCost?: number;
}

export interface AgentRunWithLogs extends AgentRun {
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
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
