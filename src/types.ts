export interface Connector {
  name: string;
  type: "jira" | "github" | "gmail" | "custom";
  url: string;
  secretFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  task: string;
  connectors: string[];
  model: string;
  status: "pending" | "running" | "completed" | "failed";
  containerId: string | null;
  sessionFile: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
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
