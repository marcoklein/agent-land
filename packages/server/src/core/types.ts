import type {
  PermissionPolicy,
  SessionStatus,
  ProviderKind,
  ProviderApiType,
  ConnectorType,
  Session,
  Connector,
  Provider,
} from "@agent-land/contracts";

export type {
  PermissionPolicy,
  SessionStatus,
  ProviderKind,
  ProviderApiType,
  ConnectorType,
  Connector,
};

export type AgentSession = Session;
export type ProviderConfig = Provider;

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
