import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { FakeEngine } from "./helpers/fake-engine.js";
import { createApp } from "../app.js";
import type { SessionEvent } from "@agent-land/contracts";
import type { Express } from "express";

let engine: FakeEngine;
let app: Express;
let engineUrl: string;

const authConfig = {
  engineUrl: "",
  authHeader: "Basic dGVzdDp0ZXN0",
  port: 0,
  quietMs: 50,
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    status: "waiting_for_input",
    permissionPolicy: "auto",
    sessionDir: "/tmp/s1",
    connectors: ["github"],
    model: "deepseek-v4-pro",
    provider: "qwencloud",
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:05:00.000Z",
    waitingFor: { requestId: "r1", method: "confirm", prompt: "Design gate: approve PR #123" },
    ...overrides,
  };
}

function makeMessageEvent(text: string): SessionEvent {
  return {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  } as SessionEvent;
}

describe("web-ui integration", () => {
  beforeAll(async () => {
    engine = new FakeEngine();
    const port = await engine.start();
    engineUrl = `http://127.0.0.1:${port}`;
    authConfig.engineUrl = engineUrl;
    app = createApp(authConfig);
  });

  afterAll(async () => {
    await engine.stop();
  });

  it("serves vendor assets", async () => {
    const res = await request(app).get("/vendor/htmx.min.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("returns full HTML page for GET /", async () => {
    engine.setSessions([]);
    engine.setConnectors([]);
    engine.setProviders([]);
    engine.setMounts([]);
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).toContain('src="/vendor/htmx.min.js"');
    expect(res.text).toContain('<link rel="stylesheet" href="/vendor/pico.min.css">');
    expect(res.text).toContain('hx-get="/"');
    expect(res.text).toContain('hx-trigger="every 10s"');
    expect(res.text).toContain('hx-target="#dashboard"');
    expect(res.text).toContain("No sessions waiting");
  });

  it("returns fragment only for HX-Request", async () => {
    engine.setSessions([]);
    engine.setConnectors([]);
    engine.setProviders([]);
    engine.setMounts([]);
    const res = await request(app).get("/").set("HX-Request", "true");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<!DOCTYPE html>");
    expect(res.headers["content-type"]).toContain("html");
  });

  it("renders needs-you card for waiting session with last message", async () => {
    const s = makeSession({ id: "w1" });
    engine.setSessions([s]);
    engine.setEvents("w1", [
      { type: "turn_start" } as SessionEvent,
      makeMessageEvent("Please review: https://github.com/org/repo/pull/123"),
    ]);
    engine.setConnectors([]);
    engine.setProviders([]);
    engine.setMounts([]);

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/sessions/w1"');
    expect(res.text).toContain("Design gate");
    expect(res.text).toContain("https://github.com/org/repo/pull/123");
    expect(res.text).toContain("qwencloud/deepseek-v4-pro");
    expect(res.text).toContain("confirm");
  });

  it("does not show running sessions in needs-you", async () => {
    const running = makeSession({ id: "r1", status: "running", waitingFor: undefined });
    engine.setSessions([running]);
    engine.setConnectors([]);
    engine.setProviders([]);
    engine.setMounts([]);

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("No sessions waiting");
    expect(res.text).toContain('href="/sessions/r1"');
  });

  it("shows idle sessions in the idle section", async () => {
    const idle = makeSession({ id: "i1", status: "idle", waitingFor: undefined });
    engine.setSessions([idle]);
    engine.setConnectors([]);
    engine.setProviders([]);
    engine.setMounts([]);

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Idle");
    expect(res.text).toContain('href="/sessions/i1"');
  });

  it("shows stopped sessions collapsed", async () => {
    const stopped = makeSession({ id: "st1", status: "stopped", waitingFor: undefined });
    engine.setSessions([stopped]);
    engine.setEvents("st1", [makeMessageEvent("Done")]);
    engine.setConnectors([]);
    engine.setProviders([]);
    engine.setMounts([]);

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Stopped");
    expect(res.text).toContain('href="/sessions/st1"');
  });

  it("renders session detail page", async () => {
    const s = makeSession({ id: "d1" });
    engine.setSessions([s]);
    engine.setEvents("d1", [makeMessageEvent("Work done")]);

    const res = await request(app).get("/sessions/d1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Session");
    expect(res.text).toContain("d1");
    expect(res.text).toContain("Waiting for input");
    expect(res.text).toContain("Work done");
  });

  it("returns 404 for unknown session", async () => {
    engine.setSessions([]);
    const res = await request(app).get("/sessions/nonexist");
    expect(res.status).toBe(404);
    expect(res.text).toContain("not found");
  });

  it("renders connectors page with envKeys but no values", async () => {
    engine.setConnectors([
      { name: "github", url: "https://api.github.com", envKeys: ["GITHUB_TOKEN"], secretFile: "github.yaml", updatedAt: "2026-09-13T00:00:00Z" },
    ]);

    const res = await request(app).get("/connectors");
    expect(res.status).toBe(200);
    expect(res.text).toContain("github");
    expect(res.text).toContain("GITHUB_TOKEN");
    expect(res.text).not.toContain("ghp_"); // no secret values
  });

  it("renders providers page with enabled/disabled badges", async () => {
    engine.setProviders([
      { id: "qwencloud", label: "Qwen", api: "anthropic-messages", baseUrl: "https://api.example.com", models: ["deepseek-v4-pro"], defaultModel: "deepseek-v4-pro", enabled: true },
      { id: "spent", label: "Spent", enabled: false },
    ]);

    const res = await request(app).get("/providers");
    expect(res.status).toBe(200);
    expect(res.text).toContain("qwencloud");
    expect(res.text).toContain("enabled");
    expect(res.text).toContain("disabled");
  });

  it("renders mounts page", async () => {
    engine.setMounts([
      { name: "data", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z" },
    ]);

    const res = await request(app).get("/mounts");
    expect(res.status).toBe(200);
    expect(res.text).toContain("data");
  });

  it("shows error banner when engine is unreachable", async () => {
    const emptyConfig = { ...authConfig, engineUrl: "http://127.0.0.1:1" };
    const app2 = createApp(emptyConfig);
    const res = await request(app2).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Error:");
  });

  it("displays connectors page when empty", async () => {
    engine.setConnectors([]);
    const res = await request(app).get("/connectors");
    expect(res.status).toBe(200);
    expect(res.text).toContain("No connectors defined");
  });

  it("poll simulation: session moves from running to needs-you", async () => {
    const s = makeSession({ id: "p1", status: "running", waitingFor: undefined });
    engine.setSessions([s]);
    engine.setConnectors([]);
    engine.setProviders([]);
    engine.setMounts([]);

    // Poll 1: running
    const res1 = await request(app).get("/").set("HX-Request", "true");
    expect(res1.text).toContain("No sessions waiting");
    expect(res1.text).not.toContain("<!DOCTYPE html>");

    // Mutate
    s.status = "waiting_for_input";
    s.waitingFor = { requestId: "r2", method: "confirm", prompt: "Merge?" };
    s.updatedAt = "2026-09-13T12:10:00.000Z";
    engine.setEvents("p1", [makeMessageEvent("Ready to merge")]);

    // Poll 2: waiting
    const res2 = await request(app).get("/").set("HX-Request", "true");
    expect(res2.text).toContain("Merge?");
    expect(res2.text).toContain("Ready to merge");
  });

  it("caches last message — two polls with same updatedAt reuse cache", async () => {
    const s = makeSession({ id: "c1" });
    s.updatedAt = "2026-01-01T00:00:00.000Z";
    engine.setSessions([s]);
    engine.setEvents("c1", [makeMessageEvent("Cached content")]);
    engine.setConnectors([]);
    engine.setProviders([]);
    engine.setMounts([]);
    engine.connectionCounts = new Map();

    await request(app).get("/").set("HX-Request", "true");
    const countAfterFirst = engine.connectionCounts.get("c1") ?? 0;

    await request(app).get("/").set("HX-Request", "true");
    const countAfterSecond = engine.connectionCounts.get("c1") ?? 0;

    expect(countAfterFirst).toBeGreaterThanOrEqual(1);
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});