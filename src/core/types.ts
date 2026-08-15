export type PermissionPolicy = "auto" | "manual";

export type SessionStatus = "running" | "waiting_for_input" | "idle" | "stopped";

export interface AgentSession {
  id: string;
  status: SessionStatus;
  permissionPolicy: PermissionPolicy;
  sessionDir: string;
  connectors: string[];
  model: string;
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
