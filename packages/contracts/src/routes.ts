import type { SessionEnvelope, SessionListEnvelope } from "./session.js";
import type { ConnectorEnvelope, ConnectorListEnvelope, ConnectorFieldsEnvelope } from "./connector.js";
import type { ProviderEnvelope, ProviderListEnvelope, ProviderCatalogEnvelope } from "./provider.js";
import type { AcceptedEnvelope, DeletedEnvelope, ModelsEnvelope, CopilotStartEnvelope, CopilotPollEnvelope } from "./http.js";

export interface EndpointDef<Req, Res> {
  method: "GET" | "POST" | "DELETE";
  path: string;
  summary: string;
  request: Req;
  response: Res;
}

function endpoint<Req, Res>(
  method: EndpointDef<Req, Res>["method"],
  path: string,
  summary: string
): EndpointDef<Req, Res> {
  return { method, path, summary } as EndpointDef<Req, Res>;
}

export const api = {
  sessions: {
    create: endpoint<unknown, SessionEnvelope>("POST", "/api/sessions", "Launch a new agent session"),
    list: endpoint<void, SessionListEnvelope>("GET", "/api/sessions", "List sessions"),
    get: endpoint<void, SessionEnvelope>("GET", "/api/sessions/:id", "Get one session"),
    prompt: endpoint<unknown, AcceptedEnvelope>("POST", "/api/sessions/:id/prompt", "Send a message or steer"),
    respond: endpoint<unknown, AcceptedEnvelope>("POST", "/api/sessions/:id/respond", "Answer a permission dialog"),
    abort: endpoint<void, AcceptedEnvelope>("POST", "/api/sessions/:id/abort", "Abort the current turn"),
    remove: endpoint<void, DeletedEnvelope>("DELETE", "/api/sessions/:id", "Kill and remove a session"),
    events: endpoint<void, never>("GET", "/api/sessions/:id/events", "Live event stream (SSE)"),
  },
  connectors: {
    list: endpoint<void, ConnectorListEnvelope>("GET", "/api/connectors", "List connectors"),
    fields: endpoint<void, ConnectorFieldsEnvelope>("GET", "/api/connectors/fields", "Connector field schema per type"),
    create: endpoint<unknown, ConnectorEnvelope>("POST", "/api/connectors", "Create a connector (encrypts secret)"),
    remove: endpoint<void, DeletedEnvelope>("DELETE", "/api/connectors/:name", "Delete a connector"),
  },
  models: {
    list: endpoint<void, ModelsEnvelope>("GET", "/api/models", "Discover models for a provider"),
  },
  providers: {
    list: endpoint<void, ProviderListEnvelope>("GET", "/api/providers", "List providers"),
    catalog: endpoint<void, ProviderCatalogEnvelope>("GET", "/api/providers/catalog", "Built-in provider catalog"),
    create: endpoint<unknown, ProviderEnvelope>("POST", "/api/providers", "Create a provider"),
    enable: endpoint<void, ProviderEnvelope>("POST", "/api/providers/:id/enable", "Enable a provider"),
    disable: endpoint<void, ProviderEnvelope>("POST", "/api/providers/:id/disable", "Disable a provider"),
    remove: endpoint<void, DeletedEnvelope>("DELETE", "/api/providers/:id", "Delete a provider"),
  },
  copilot: {
    start: endpoint<void, CopilotStartEnvelope>("POST", "/api/providers/copilot/start", "Start Copilot device flow"),
    poll: endpoint<unknown, CopilotPollEnvelope>("POST", "/api/providers/copilot/poll", "Poll for Copilot token"),
  },
} as const;

export type Api = typeof api;
