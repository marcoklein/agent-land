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

/**
 * Server-side session record. Extends the public Session contract with an
 * ephemeral platform loopback token that is persisted in the flat-JSON record
 * (ADR 008) but must never be returned over the API.
 */
export type AgentSession = Session & {
  platformToken?: string;
};
export type ProviderConfig = Provider;
export type MountRecord = Mount;

export const DEFAULT_PROVIDER_ID = "opencode-go";

/** Username prefix for the per-session platform loopback credential (`session-<id>:<token>`). */
export const PLATFORM_SESSION_PREFIX = "session-";

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