import type { Config } from "./types.js";

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
    createSession: (opts: RequestOptions) => request("POST", "/api/sessions", opts),
    getSession: (id: string) => request("GET", `/api/sessions/${id}`),
    listSessions: () => request("GET", "/api/sessions"),
    prompt: (id: string, message: string, behavior?: string) =>
      request("POST", `/api/sessions/${id}/prompt`, {
        message,
        ...(behavior ? { behavior } : {}),
      }),
    respond: (id: string, requestId: string, value: RequestOptions) =>
      request("POST", `/api/sessions/${id}/respond`, { requestId, ...value }),
    abort: (id: string) => request("POST", `/api/sessions/${id}/abort`, {}),
    deleteSession: (id: string) => request("DELETE", `/api/sessions/${id}`),
    listModels: (provider?: string) =>
      request("GET", `/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
    listProviders: () => request("GET", "/api/providers"),
    createProvider: (opts: RequestOptions) => request("POST", "/api/providers", opts),
    deleteProvider: (id: string) =>
      request("DELETE", `/api/providers/${encodeURIComponent(id)}`),
    startCopilotLogin: () => request("POST", "/api/providers/copilot/start"),
    pollCopilotLogin: (deviceCode: string) =>
      request("POST", "/api/providers/copilot/poll", { deviceCode }),
    listConnectors: () => request("GET", "/api/connectors"),
    connectorFields: (type: string) =>
      request("GET", `/api/connectors/fields?type=${encodeURIComponent(type)}`),
    createConnector: (opts: RequestOptions) => request("POST", "/api/connectors", opts),
    deleteConnector: (name: string) =>
      request("DELETE", `/api/connectors/${encodeURIComponent(name)}`),
    eventsUrl: (id: string) => `${url}/api/sessions/${id}/events`,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
