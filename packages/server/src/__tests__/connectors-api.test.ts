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
    url: "https://api.github.com",
    env: { GITHUB_TOKEN: "ghp_test123" },
  };

  it("returns an empty list", async () => {
    const res = await api.get("/api/connectors");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connectors: [] });
  });

  it("creates a connector and returns metadata only", async () => {
    const res = await api.post("/api/connectors").send(githubCreds);

    expect(res.status).toBe(201);
    expect(res.body.connector.name).toBe("GitHub Personal");
    expect(res.body.connector.url).toBe("https://api.github.com");
    expect(res.body.connector.secretFile).toBe("github-personal.yaml");
    expect(res.body.connector.env.GITHUB_TOKEN).toBe("ghp_test123");

    const secretPath = path.join(config.secretsDir, "github-personal.yaml");
    await expect(stat(secretPath)).resolves.toBeDefined();
  });

  it("creates a connector from YAML content", async () => {
    const res = await api.post("/api/connectors").send({
      name: "Internal API",
      url: "https://internal.example",
      content: "API_KEY: secret",
    });

    expect(res.status).toBe(201);
    expect(res.body.connector.secretFile).toBe("internal-api.yaml");
  });

  it("lists connectors", async () => {
    await api.post("/api/connectors").send(githubCreds);

    const res = await api.get("/api/connectors");

    expect(res.status).toBe(200);
    const [connector] = res.body.connectors;
    expect(connector.name).toBe("GitHub Personal");
  });

  it("rejects missing credentials with 400", async () => {
    const res = await api.post("/api/connectors").send({
      name: "Broken",
      url: "https://api.github.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("required");
  });

  it("rejects duplicate names with 409", async () => {
    await api.post("/api/connectors").send(githubCreds);

    const res = await api.post("/api/connectors").send({
      ...githubCreds,
      env: { GITHUB_TOKEN: "different" },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already exists");
  });

  it("rejects names whose slug collides with an existing connector", async () => {
    await api.post("/api/connectors").send(githubCreds);

    const res = await api.post("/api/connectors").send({
      name: "github-personal",
      url: "https://api.github.com",
      env: { GITHUB_TOKEN: "other" },
    });

    expect(res.status).toBe(409);
  });

  it("rejects names that slugify to an empty string", async () => {
    const res = await api.post("/api/connectors").send({
      name: "!!!",
      url: "https://example.com",
      content: "KEY: value",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("letter or number");
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