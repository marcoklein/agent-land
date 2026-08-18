import { describe, it, expect, beforeEach, afterAll } from "vitest";
import path from "path";
import { stat } from "fs/promises";
import request from "supertest";
import { createAgentTestApp, setupDataDir, cleanupDataDir } from "./helpers/setup.js";
import { getConfig } from "../config.js";

const config = getConfig();

describe("Connectors JSON API", () => {
  const app = createAgentTestApp().app;
  const api = request.agent(app);

  beforeEach(async () => {
    await setupDataDir();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  const githubCreds = {
    name: "GitHub Personal",
    type: "github",
    url: "https://api.github.com",
    fields: { GITHUB_TOKEN: "ghp_test123" },
  };

  it("returns an empty list", async () => {
    const res = await api.get("/api/connectors");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connectors: [] });
  });

  it("creates a typed connector and returns metadata only", async () => {
    const res = await api.post("/api/connectors").send(githubCreds);

    expect(res.status).toBe(201);
    expect(res.body.connector.name).toBe("GitHub Personal");
    expect(res.body.connector.type).toBe("github");
    expect(res.body.connector.url).toBe("https://api.github.com");
    expect(res.body.connector.secretFile).toBe("github-personal.yaml");
    expect(res.body.connector.fields).toBeUndefined();
    expect(res.body.connector.content).toBeUndefined();

    const secretPath = path.join(config.secretsDir, "github-personal.yaml");
    await expect(stat(secretPath)).resolves.toBeDefined();
  });

  it("creates a custom connector from YAML content", async () => {
    const res = await api.post("/api/connectors").send({
      name: "Internal API",
      type: "custom",
      url: "https://internal.example",
      content: "API_KEY: secret",
    });

    expect(res.status).toBe(201);
    expect(res.body.connector.secretFile).toBe("internal-api.yaml");
  });

  it("lists connectors without secret fields", async () => {
    await api.post("/api/connectors").send(githubCreds);

    const res = await api.get("/api/connectors");

    expect(res.status).toBe(200);
    const [connector] = res.body.connectors;
    expect(connector.name).toBe("GitHub Personal");
    expect(JSON.stringify(connector)).not.toContain("ghp_test123");
    expect(connector.content).toBeUndefined();
    expect(connector.fields).toBeUndefined();
  });

  it("rejects missing required fields with 400", async () => {
    const res = await api.post("/api/connectors").send({
      name: "Broken",
      type: "github",
      url: "https://api.github.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Personal Access Token");
  });

  it("rejects custom connectors without content with 400", async () => {
    const res = await api.post("/api/connectors").send({
      name: "Internal API",
      type: "custom",
      url: "https://internal.example",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("content is required");
  });

  it("rejects duplicate names with 409", async () => {
    await api.post("/api/connectors").send(githubCreds);

    const res = await api.post("/api/connectors").send({
      ...githubCreds,
      fields: { GITHUB_TOKEN: "different" },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already exists");
  });

  it("exposes typed field definitions", async () => {
    const res = await api.get("/api/connectors/fields?type=jira");

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("jira");
    expect(res.body.fields.map((f: { envVar: string }) => f.envVar)).toEqual([
      "JIRA_EMAIL",
      "JIRA_API_TOKEN",
    ]);
  });

  it("reports custom type for unknown field types", async () => {
    const res = await api.get("/api/connectors/fields?type=slack");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: "custom", fields: null });
  });

  it("deletes a connector and its secret file", async () => {
    await api.post("/api/connectors").send(githubCreds);

    const res = await api.delete("/api/connectors/GitHub%20Personal");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    const listRes = await api.get("/api/connectors");
    expect(listRes.body.connectors).toHaveLength(0);

    const secretPath = path.join(config.secretsDir, "github-personal.yaml");
    await expect(stat(secretPath)).rejects.toThrow();
  });

  it("delete is idempotent for unknown names", async () => {
    const res = await api.delete("/api/connectors/does-not-exist");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
  });
});

describe("Models JSON API", () => {
  const app = createAgentTestApp().app;

  beforeEach(async () => {
    await setupDataDir();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  it("returns a models array", async () => {
    const res = await request(app).get("/api/models");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.models)).toBe(true);
  });
});
