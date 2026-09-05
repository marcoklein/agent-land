import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createAgentTestApp, setupDataDir, cleanupDataDir, getDataDir } from "./helpers/setup.js";
import { JsonSessionRepository } from "../infra/repositories.js";
import { createApiAuthMiddleware, parseAuthorizationHeader, safeEqual } from "../presentation/http/auth.js";
import { parseBasicAuthValue, type Config } from "../config.js";
import { getConfig } from "../config.js";
import type { AgentSession } from "../core/types.js";
import type { SessionService } from "../core/session-service.js";

type Ctx = ReturnType<typeof createAgentTestApp>;

describe("Platform Connector — credential minting and injection", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    await setupDataDir();
    ctx = createAgentTestApp();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  it("injects AGENT_LAND_URL and a scoped credential only when platform is true", async () => {
    await ctx.sessionService.createSession({ platform: true });
    await ctx.sessionService.createSession({});

    const [platform, plain] = ctx.mockDocker.created;
    expect(platform.envVars.AGENT_LAND_URL).toBe(getConfig().agentLandUrl);
    expect(platform.envVars.AGENT_LAND_BASIC_AUTH).toMatch(/^session-[a-f0-9]{8}:[A-Za-z0-9_-]{40,}$/);
    expect(plain.envVars.AGENT_LAND_URL).toBeUndefined();
    expect(plain.envVars.AGENT_LAND_BASIC_AUTH).toBeUndefined();
  });

  it("mints a unique token per session and persists it in the flat-JSON record", async () => {
    const a = await ctx.sessionService.createSession({ platform: true });
    const b = await ctx.sessionService.createSession({ platform: true });

    const repo = new JsonSessionRepository(getDataDir());
    const recordA = await repo.get(a.id);
    const recordB = await repo.get(b.id);

    expect(recordA?.platformToken).toBeTruthy();
    expect(recordB?.platformToken).toBeTruthy();
    expect(recordA?.platformToken).not.toBe(recordB?.platformToken);
    expect(recordA?.platform).toBe(true);
  });

  it("does not leak the token over the JSON API", async () => {
    const res = await request(ctx.app)
      .post("/api/sessions")
      .send({ platform: true, parentSessionId: "parent123" });

    expect(res.status).toBe(201);
    expect(res.body.session.platform).toBe(true);
    expect(res.body.session.parentSessionId).toBe("parent123");
    expect(JSON.stringify(res.body)).not.toContain("platformToken");
  });

  it("returns platform and parentSessionId on GET and list", async () => {
    const parent = await request(ctx.app).post("/api/sessions").send({ platform: true });
    const parentId = parent.body.session.id as string;
    await request(ctx.app).post("/api/sessions").send({ platform: false, parentSessionId: parentId });

    const single = await request(ctx.app).get(`/api/sessions/${parentId}`);
    expect(single.body.session.platform).toBe(true);
    expect(single.body.session.parentSessionId).toBeUndefined();

    const list = await request(ctx.app).get("/api/sessions");
    const child = list.body.sessions.find((s: AgentSession) => s.parentSessionId === parentId);
    expect(child).toBeTruthy();
    expect(child.platform).toBe(false);
  });
});

describe("Platform Connector — credential revocation", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    await setupDataDir();
    ctx = createAgentTestApp();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  it("clears the token when a live session is killed", async () => {
    const session = await ctx.sessionService.createSession({ platform: true });
    const repo = new JsonSessionRepository(getDataDir());
    expect((await repo.get(session.id))?.platformToken).toBeTruthy();

    await ctx.sessionService.kill(session.id);

    expect((await repo.get(session.id))?.platformToken).toBeUndefined();
    expect((await repo.get(session.id))?.status).toBe("stopped");
  });

  it("clears the token when an orphaned session is marked stopped during recovery", async () => {
    const repo = new JsonSessionRepository(getDataDir());
    const now = new Date().toISOString();
    await repo.save({
      id: "orphan01",
      status: "running",
      permissionPolicy: "auto",
      sessionDir: "/sessions/orphan01",
      connectors: [],
      model: "test-model",
      platform: true,
      platformToken: "should-be-revoked",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.sessionService.recover();

    expect((await repo.get("orphan01"))?.platformToken).toBeUndefined();
    expect((await repo.get("orphan01"))?.status).toBe("stopped");
  });
});

describe("Platform Connector — API auth middleware", () => {
  let ctx: Ctx;
  let sessionService: SessionService;

  beforeEach(async () => {
    await setupDataDir();
    ctx = createAgentTestApp();
    sessionService = ctx.sessionService;
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  function authApp(config: Config) {
    const app = express();
    app.use(express.json());
    app.use("/api", createApiAuthMiddleware(sessionService, config));
    app.get("/api/probe", (_req, res) => res.json({ ok: true }));
    return app;
  }

  it("requires operator or session credentials when an operator credential is configured", async () => {
    const config: Config = { ...getConfig(), operatorBasicAuth: { user: "op", password: "pw" } };
    const app = authApp(config);

    await request(app).get("/api/probe").expect(401);

    await request(app)
      .get("/api/probe")
      .set("Authorization", "Basic " + Buffer.from("op:pw").toString("base64"))
      .expect(200);

    await request(app)
      .get("/api/probe")
      .set("Authorization", "Basic " + Buffer.from("op:wrong").toString("base64"))
      .expect(401);
  });

  it("accepts a session-scoped credential when no operator credential is configured", async () => {
    const app = authApp(getConfig());
    await request(app).get("/api/probe").expect(200);

    const session = await sessionService.createSession({ platform: true });
    const repo = new JsonSessionRepository(getDataDir());
    const record = await repo.get(session.id);

    await request(app)
      .get("/api/probe")
      .set(
        "Authorization",
        "Basic " + Buffer.from(`session-${session.id}:${record!.platformToken}`).toString("base64")
      )
      .expect(200);
  });

  it("rejects an unknown or wrong session credential", async () => {
    const config: Config = { ...getConfig(), operatorBasicAuth: { user: "op", password: "pw" } };
    const app = authApp(config);
    const session = await sessionService.createSession({ platform: true });
    const repo = new JsonSessionRepository(getDataDir());
    const record = await repo.get(session.id);

    await request(app)
      .get("/api/probe")
      .set(
        "Authorization",
        "Basic " + Buffer.from(`session-${session.id}:wrong-token`).toString("base64")
      )
      .expect(401);

    await request(app)
      .get("/api/probe")
      .set(
        "Authorization",
        "Basic " + Buffer.from(`session-unknown:${record!.platformToken}`).toString("base64")
      )
      .expect(401);
  });

  it("revokes a session credential after the session is killed", async () => {
    const config: Config = { ...getConfig(), operatorBasicAuth: { user: "op", password: "pw" } };
    const app = authApp(config);
    const session = await sessionService.createSession({ platform: true });
    const repo = new JsonSessionRepository(getDataDir());
    const token = (await repo.get(session.id))!.platformToken;
    const header = "Basic " + Buffer.from(`session-${session.id}:${token}`).toString("base64");

    await request(app).get("/api/probe").set("Authorization", header).expect(200);

    await sessionService.kill(session.id);

    await request(app).get("/api/probe").set("Authorization", header).expect(401);
  });
});

describe("basic-auth helpers", () => {
  it("parses operator credential values", () => {
    expect(parseBasicAuthValue("user:pass")).toEqual({ user: "user", password: "pass" });
    expect(parseBasicAuthValue("user:pa:ss")).toEqual({ user: "user", password: "pa:ss" });
    expect(parseBasicAuthValue("nocolon")).toBeUndefined();
  });

  it("parses authorization headers", () => {
    const header = "Basic " + Buffer.from("session-abc:token").toString("base64");
    expect(parseAuthorizationHeader(header)).toEqual({ user: "session-abc", password: "token" });
    expect(parseAuthorizationHeader(undefined)).toBeUndefined();
    expect(parseAuthorizationHeader("Bearer x")).toBeUndefined();
  });

  it("compares strings in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
