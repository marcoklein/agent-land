import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as cheerio from "cheerio";
import request from "supertest";
import type { Express } from "express";
import { createAgentTestApp, MockDockerPort, setupDataDir, cleanupDataDir } from "./helpers/setup.js";

describe("Providers — API and launch flow", () => {
  let app: Express;
  let mockDocker: MockDockerPort;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    await setupDataDir();
    const created = createAgentTestApp();
    app = created.app;
    mockDocker = created.mockDocker;
    agent = request.agent(app);
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  it("creates a custom provider and lists it", async () => {
    const create = await agent.post("/api/providers").send({
      id: "qwencloud",
      kind: "custom",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      models: ["qwen3.8-max", "deepseek-v4-pro"],
      secretFields: { QWENCLOUD_API_KEY: "sk-test" },
    });
    expect(create.status).toBe(201);
    expect(create.body.provider.id).toBe("qwencloud");
    expect(create.body.provider.kind).toBe("custom");

    const list = await agent.get("/api/providers");
    expect(list.status).toBe(200);
    expect(list.body.providers.map((p: { id: string }) => p.id)).toContain("qwencloud");
  });

  it("returns static models for a custom provider", async () => {
    await agent.post("/api/providers").send({
      id: "qwencloud",
      kind: "custom",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      models: ["qwen3.8-max", "deepseek-v4-pro"],
    });

    const res = await agent.get("/api/models?provider=qwencloud");
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(["qwen3.8-max", "deepseek-v4-pro"]);
  });

  it("rejects a duplicate provider with 409", async () => {
    await agent
      .post("/api/providers")
      .send({ id: "mistral", kind: "builtin", secretFields: { MISTRAL_API_KEY: "sk" } });
    const dup = await agent
      .post("/api/providers")
      .send({ id: "mistral", kind: "builtin", secretFields: { MISTRAL_API_KEY: "sk" } });
    expect(dup.status).toBe(409);
  });

  it("deletes a provider and 404s on a missing one", async () => {
    await agent
      .post("/api/providers")
      .send({ id: "mistral", kind: "builtin", secretFields: { MISTRAL_API_KEY: "sk" } });

    const del = await agent.delete("/api/providers/mistral");
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    const missing = await agent.delete("/api/providers/mistral");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain("not found");

    const list = await agent.get("/api/providers");
    expect(list.body.providers).toHaveLength(0);
  });

  it("injects the provider secret into the session container env", async () => {
    await agent
      .post("/api/providers")
      .send({ id: "mistral", kind: "builtin", secretFields: { MISTRAL_API_KEY: "sk-test-key" } });

    const create = await agent
      .post("/api/sessions")
      .send({ provider: "mistral", model: "mistral-large-latest" });
    expect(create.status).toBe(201);
    expect(create.body.session.provider).toBe("mistral");

    const created = mockDocker.created[0];
    expect(created.envVars.MISTRAL_API_KEY).toBe("sk-test-key");
    expect(created.envVars.OPENCODE_API_KEY).toBeUndefined();
  });

  it("bootstraps OPENCODE_API_KEY from config for the default provider", async () => {
    await agent.post("/api/sessions").send({});
    const created = mockDocker.created[0];
    expect(created.envVars.OPENCODE_API_KEY).toBe("test-key");
  });

  it("writes models.json for a custom provider session", async () => {
    await agent.post("/api/providers").send({
      id: "qwencloud",
      kind: "custom",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      models: ["qwen3.8-max"],
      secretFields: { QWENCLOUD_API_KEY: "sk" },
    });

    await agent.post("/api/sessions").send({ provider: "qwencloud", model: "qwen3.8-max" });

    const modelsFile = mockDocker.writtenFiles.find((f) => f.destPath.endsWith("models.json"));
    expect(modelsFile).toBeDefined();
    const json = JSON.parse(modelsFile!.content);
    expect(json.providers.qwencloud.apiKey).toBe("$QWENCLOUD_API_KEY");
    expect(json.providers.qwencloud.models).toEqual([{ id: "qwen3.8-max" }]);
  });

  it("renders the provider select and model-options fragment", async () => {
    await agent.post("/api/providers").send({
      id: "qwencloud",
      kind: "custom",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      models: ["qwen3.8-max"],
    });

    const newPage = await agent.get("/agents/new");
    expect(newPage.status).toBe(200);
    const $ = cheerio.load(newPage.text);
    expect($("select#provider").length).toBe(1);
    expect($("select#model").length).toBe(1);

    const fragment = await agent.get("/agents/model-options?provider=qwencloud");
    expect(fragment.status).toBe(200);
    expect(fragment.text).toContain("qwen3.8-max");
    expect(fragment.text).toContain('name="model"');
  });

  it("launches a session with a provider via the form", async () => {
    await agent
      .post("/api/providers")
      .send({ id: "mistral", kind: "builtin", secretFields: { MISTRAL_API_KEY: "sk" } });

    const launch = await agent
      .post("/agents/run")
      .send({ task: "hi", provider: "mistral", model: "mistral-large-latest" });
    expect(launch.status).toBe(302);

    const id = (launch.headers.location as string).match(/\/agents\/([^/]+)/)![1];
    const detail = await agent.get(`/agents/${id}`);
    expect(detail.text).toContain("mistral");
  });
});
