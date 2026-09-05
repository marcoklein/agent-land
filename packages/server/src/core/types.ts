import type {
  PermissionPolicy,
  SessionStatus,
  Session,
  Connector,
  Provider,
  Mount,
} from "@agent-land/contracts";

export type {
  PermissionPolicy,
  SessionStatus,
  Connector,
  Mount,
};

export type AgentSession = Session;
export type ProviderConfig = Provider;
export type MountRecord = Mount;

export const DEFAULT_PROVIDER_ID = "opencode-go";

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