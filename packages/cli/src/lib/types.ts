import type {
  Session,
  SessionStatus,
  PermissionPolicy,
  Connector,
  ConnectorType,
  ConnectorFieldDef,
  Provider,
  ProviderKind,
  ProviderApiType,
  ProviderCatalogItem,
  SessionEvent,
  SsePayload,
  Message,
  MessageBlock,
  SessionEnvelope,
  SessionListEnvelope,
  ConnectorEnvelope,
  ConnectorListEnvelope,
  ConnectorFieldsEnvelope,
  ProviderEnvelope,
  ProviderListEnvelope,
  ProviderCatalogEnvelope,
  ModelsEnvelope,
  AcceptedEnvelope,
  DeletedEnvelope,
  CopilotStartEnvelope,
  CopilotPollEnvelope,
  CreateSessionInput,
  CreateConnectorInput,
} from "@agent-land/contracts";

export type {
  Session,
  SessionStatus,
  PermissionPolicy,
  Connector,
  ConnectorType,
  ConnectorFieldDef,
  Provider,
  ProviderKind,
  ProviderApiType,
  ProviderCatalogItem,
  SessionEvent,
  SsePayload,
  Message,
  MessageBlock,
  SessionEnvelope,
  SessionListEnvelope,
  ConnectorEnvelope,
  ConnectorListEnvelope,
  ConnectorFieldsEnvelope,
  ProviderEnvelope,
  ProviderListEnvelope,
  ProviderCatalogEnvelope,
  ModelsEnvelope,
  AcceptedEnvelope,
  DeletedEnvelope,
  CopilotStartEnvelope,
  CopilotPollEnvelope,
  CreateSessionInput,
  CreateConnectorInput,
};

export type SessionSummary = Pick<
  Session,
  "id" | "status" | "createdAt" | "model" | "provider" | "connectors"
>;
export type ConnectorSummary = Pick<Connector, "name" | "type" | "url">;
export type ProviderSummary = Pick<
  Provider,
  "id" | "kind" | "label" | "api" | "enabled" | "defaultModel"
>;
export type AgentEvent = SsePayload;
export type WaitingForInput = Extract<SessionEvent, { type: "waiting_for_input" }>;

export interface SseEvent {
  event?: string;
  data?: string;
}

export interface RenderLine {
  kind: string;
  text: string;
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
