import type { SessionEnvelope, SessionListEnvelope } from "./session.js";
import type { ConnectorEnvelope, ConnectorListEnvelope } from "./connector.js";
import type { MountEnvelope, MountListEnvelope } from "./mount.js";
import type { ProviderEnvelope, ProviderListEnvelope } from "./provider.js";
import type { AcceptedEnvelope, DeletedEnvelope, ModelsEnvelope } from "./http.js";

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
    create: endpoint<unknown, ConnectorEnvelope>("POST", "/api/connectors", "Create a connector (encrypts secrets)"),
    remove: endpoint<void, DeletedEnvelope>("DELETE", "/api/connectors/:name", "Delete a connector"),
  },
  mounts: {
    list: endpoint<void, MountListEnvelope>("GET", "/api/mounts", "List mounts"),
    create: endpoint<unknown, MountEnvelope>("POST", "/api/mounts", "Create a named mount (labeled Docker volume)"),
    remove: endpoint<void, DeletedEnvelope>("DELETE", "/api/mounts/:name", "Delete a mount (fails while a live session binds it)"),
  },
  models: {
    list: endpoint<void, ModelsEnvelope>("GET", "/api/models", "Discover models for a provider"),
  },
  providers: {
    list: endpoint<void, ProviderListEnvelope>("GET", "/api/providers", "List providers"),
    create: endpoint<unknown, ProviderEnvelope>("POST", "/api/providers", "Create a provider"),
    enable: endpoint<void, ProviderEnvelope>("POST", "/api/providers/:id/enable", "Enable a provider"),
    disable: endpoint<void, ProviderEnvelope>("POST", "/api/providers/:id/disable", "Disable a provider"),
    remove: endpoint<void, DeletedEnvelope>("DELETE", "/api/providers/:id", "Delete a provider"),
  },
} as const;

export type Api = typeof api;