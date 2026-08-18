import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createApiClient } from "./api.mjs";

let server;
let baseUrl;
let requests = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body ? JSON.parse(body) : undefined,
      });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "DELETE") {
        res.statusCode = 409;
        res.end(JSON.stringify({ error: "Session is stopped" }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

describe("createApiClient", () => {
  it("sends the auth header on every request", async () => {
    const client = createApiClient({ url: baseUrl, authHeader: "Basic dTpw" });
    await client.listSessions();
    expect(requests.at(-1).headers.authorization).toBe("Basic dTpw");
  });

  it("creates a session with the given payload", async () => {
    const client = createApiClient({ url: baseUrl });
    await client.createSession({ connectors: ["github"], permissionPolicy: "manual" });
    const r = requests.at(-1);
    expect(r.method).toBe("POST");
    expect(r.url).toBe("/api/sessions");
    expect(r.body).toEqual({ connectors: ["github"], permissionPolicy: "manual" });
  });

  it("sends prompts with behavior when given", async () => {
    const client = createApiClient({ url: baseUrl });
    await client.prompt("abc", "hello", "followUp");
    expect(requests.at(-1).body).toEqual({ message: "hello", behavior: "followUp" });

    await client.prompt("abc", "plain");
    expect(requests.at(-1).body).toEqual({ message: "plain" });
  });

  it("responds to dialogs with exactly one payload field", async () => {
    const client = createApiClient({ url: baseUrl });
    await client.respond("abc", "r1", { confirmed: true });
    expect(requests.at(-1).body).toEqual({ requestId: "r1", confirmed: true });
  });

  it("surfaces API errors as Error with status", async () => {
    const client = createApiClient({ url: baseUrl });
    await expect(client.deleteSession("x")).rejects.toThrow("Session is stopped");
  });

  it("lists models", async () => {
    const client = createApiClient({ url: baseUrl });
    await client.listModels();
    const r = requests.at(-1);
    expect(r.method).toBe("GET");
    expect(r.url).toBe("/api/models");
  });

  it("lists connectors", async () => {
    const client = createApiClient({ url: baseUrl });
    await client.listConnectors();
    const r = requests.at(-1);
    expect(r.method).toBe("GET");
    expect(r.url).toBe("/api/connectors");
  });

  it("fetches connector field definitions URL-encoded", async () => {
    const client = createApiClient({ url: baseUrl });
    await client.connectorFields("my type");
    expect(requests.at(-1).url).toBe("/api/connectors/fields?type=my%20type");
  });

  it("creates a connector with the given payload", async () => {
    const client = createApiClient({ url: baseUrl });
    await client.createConnector({
      name: "GitHub",
      type: "github",
      url: "https://api.github.com",
      fields: { GITHUB_TOKEN: "ghp_x" },
    });
    const r = requests.at(-1);
    expect(r.method).toBe("POST");
    expect(r.url).toBe("/api/connectors");
    expect(r.body).toEqual({
      name: "GitHub",
      type: "github",
      url: "https://api.github.com",
      fields: { GITHUB_TOKEN: "ghp_x" },
    });
  });

  it("deletes a connector URL-encoded", async () => {
    const client = createApiClient({ url: baseUrl });
    await expect(client.deleteConnector("my connector")).rejects.toThrow();
    expect(requests.at(-1).url).toBe("/api/connectors/my%20connector");
  });
});
