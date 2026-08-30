import type {
  Config,
  SessionEnvelope,
  SessionListEnvelope,
  AcceptedEnvelope,
  DeletedEnvelope,
  ConnectorEnvelope,
  ConnectorListEnvelope,
  ProviderEnvelope,
  ProviderListEnvelope,
  ModelsEnvelope,
} from "./types.js";

type RequestOptions = Record<string, unknown>;

interface ApiError extends Error {
  status?: number;
}

export function createApiClient({ url, authHeader }: Config) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers.Authorization = authHeader;

  async function request(method: string, path: string, body?: RequestOptions): Promise<any> {
    const res = await fetch(url + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    if (!res.ok) {
      const message =
        data && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      const err: ApiError = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    url,
    authHeader,
    createSession: (opts: RequestOptions): Promise<SessionEnvelope> =>
      request("POST", "/api/sessions", opts),
    getSession: (id: string): Promise<SessionEnvelope> =>
      request("GET", `/api/sessions/${id}`),
    listSessions: (): Promise<SessionListEnvelope> => request("GET", "/api/sessions"),
    prompt: (id: string, message: string, behavior?: string): Promise<AcceptedEnvelope> =>
      request("POST", `/api/sessions/${id}/prompt`, {
        message,
        ...(behavior ? { behavior } : {}),
      }),
    respond: (id: string, requestId: string, value: RequestOptions): Promise<AcceptedEnvelope> =>
      request("POST", `/api/sessions/${id}/respond`, { requestId, ...value }),
    abort: (id: string): Promise<AcceptedEnvelope> =>
      request("POST", `/api/sessions/${id}/abort`, {}),
    deleteSession: (id: string): Promise<DeletedEnvelope> =>
      request("DELETE", `/api/sessions/${id}`),
    listModels: (provider?: string): Promise<ModelsEnvelope> =>
      request("GET", `/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
    listProviders: (): Promise<ProviderListEnvelope> => request("GET", "/api/providers"),
    createProvider: (opts: RequestOptions): Promise<ProviderEnvelope> =>
      request("POST", "/api/providers", opts),
    deleteProvider: (id: string): Promise<DeletedEnvelope> =>
      request("DELETE", `/api/providers/${encodeURIComponent(id)}`),
    listConnectors: (): Promise<ConnectorListEnvelope> => request("GET", "/api/connectors"),
    createConnector: (opts: RequestOptions): Promise<ConnectorEnvelope> =>
      request("POST", "/api/connectors", opts),
    deleteConnector: (name: string): Promise<DeletedEnvelope> =>
      request("DELETE", `/api/connectors/${encodeURIComponent(name)}`),
    eventsUrl: (id: string) => `${url}/api/sessions/${id}/events`,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;