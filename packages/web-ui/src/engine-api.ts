import type { Config } from "./config.js";

type RequestOptions = Record<string, unknown>;

interface ApiError extends Error {
  status?: number;
}

export function createEngineApi({ engineUrl, authHeader }: Config) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers.Authorization = authHeader;

  async function request(method: string, path: string, body?: RequestOptions): Promise<any> {
    const res = await fetch(engineUrl + path, {
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
      const message = data && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      const err: ApiError = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    engineUrl,
    authHeader,
    getSession: (id: string) => request("GET", `/api/sessions/${id}`),
    listSessions: () => request("GET", "/api/sessions"),
    listConnectors: () => request("GET", "/api/connectors"),
    listProviders: () => request("GET", "/api/providers"),
    listMounts: () => request("GET", "/api/mounts"),
    eventsUrl: (id: string) => `${engineUrl}/api/sessions/${id}/events`,
  };
}

export type EngineApi = ReturnType<typeof createEngineApi>;