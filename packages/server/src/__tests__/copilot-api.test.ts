import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createAgentTestApp, setupDataDir, cleanupDataDir } from "./helpers/setup.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockGitHubFlow() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/login/device/code")) {
        return jsonResponse(200, {
          device_code: "dc123",
          user_code: "AAAA-BBBB",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (u.includes("/login/oauth/access_token")) {
        return jsonResponse(200, { access_token: "ghu_test" });
      }
      if (u.includes("/copilot_internal/v2/token")) {
        return jsonResponse(200, { token: "tid=test", expires_at: 2000000000 });
      }
      return jsonResponse(404, {});
    })
  );
}

describe("Copilot login API", () => {
  let app: Express;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    await setupDataDir();
    app = createAgentTestApp().app;
    agent = request.agent(app);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  it("starts the device flow and completes it to create the provider", async () => {
    mockGitHubFlow();

    const start = await agent.post("/api/providers/copilot/start");
    expect(start.status).toBe(200);
    expect(start.body.userCode).toBe("AAAA-BBBB");
    expect(start.body.deviceCode).toBe("dc123");

    const poll = await agent.post("/api/providers/copilot/poll").send({ deviceCode: "dc123" });
    expect(poll.status).toBe(200);
    expect(poll.body.status).toBe("authorized");
    expect(poll.body.provider.id).toBe("github-copilot");
    expect(poll.body.provider.kind).toBe("oauth");
  });

  it("rejects a poll without a device code", async () => {
    const res = await agent.post("/api/providers/copilot/poll").send({});
    expect(res.status).toBe(400);
  });
});
