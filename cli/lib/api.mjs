export function createApiClient({ url, authHeader }) {
  const headers = { "Content-Type": "application/json" };
  if (authHeader) headers.Authorization = authHeader;

  async function request(method, path, body) {
    const res = await fetch(url + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    if (!res.ok) {
      const message =
        data && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    url,
    authHeader,
    createSession: (opts) => request("POST", "/api/sessions", opts),
    getSession: (id) => request("GET", `/api/sessions/${id}`),
    listSessions: () => request("GET", "/api/sessions"),
    prompt: (id, message, behavior) =>
      request("POST", `/api/sessions/${id}/prompt`, {
        message,
        ...(behavior ? { behavior } : {}),
      }),
    respond: (id, requestId, value) =>
      request("POST", `/api/sessions/${id}/respond`, { requestId, ...value }),
    abort: (id) => request("POST", `/api/sessions/${id}/abort`, {}),
    deleteSession: (id) => request("DELETE", `/api/sessions/${id}`),
    listModels: () => request("GET", "/api/models"),
    listConnectors: () => request("GET", "/api/connectors"),
    connectorFields: (type) =>
      request("GET", `/api/connectors/fields?type=${encodeURIComponent(type)}`),
    createConnector: (opts) => request("POST", "/api/connectors", opts),
    deleteConnector: (name) =>
      request("DELETE", `/api/connectors/${encodeURIComponent(name)}`),
    eventsUrl: (id) => `${url}/api/sessions/${id}/events`,
  };
}
