import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as cheerio from "cheerio";
import request from "supertest";
import { AgentsApi } from "./helpers/agents-api.js";
import { setupDataDir, cleanupDataDir } from "./helpers/setup.js";

describe("Agents — Sessions", () => {
  const api = new AgentsApi();

  beforeEach(async () => {
    await setupDataDir();
    api.reset();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  describe("GET /agents/new", () => {
    it("renders the launch form", async () => {
      const res = await api.openNew();

      expect(res.status).toBe(200);
      const $ = cheerio.load(res.text);
      expect($("textarea#task").length).toBe(1);
      expect($("select#model").length).toBe(1);
      expect($("select#permissionPolicy").length).toBe(1);
      expect($("button[type=submit]").text()).toContain("Launch Session");
    });

    it("shows no connectors message when none defined", async () => {
      const res = await api.openNew();

      expect(res.text).toContain("No connectors defined");
    });
  });

  describe("POST /agents/run", () => {
    it("redirects to session detail page after launch", async () => {
      const res = await api.launch({ task: "test task" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/agents\/[^/]+$/);
    });

    it("creates a session listed as running with model and connectors", async () => {
      const launchRes = await api.launch({
        task: "do the thing",
        model: "some-model",
      });
      const id = api.getSessionIdFromRedirect(launchRes);

      const detailRes = await api.getSession(id);
      const parsed = api.parseSessionDetail(detailRes);

      expect(parsed.status).toBe("running");
      expect(parsed.pageText).toContain("some-model");
    });

    it("sends the task as the first prompt", async () => {
      const launchRes = await api.launch({ task: "hello world" });
      api.getSessionIdFromRedirect(launchRes);

      expect(api.fakeHarness.handles.length).toBe(1);
      expect(api.fakeHarness.handles[0].prompts[0]).toContain("hello world");    });

    it("stores manual permission policy", async () => {
      const launchRes = await api.launch({ task: "manual", permissionPolicy: "manual" });
      const id = api.getSessionIdFromRedirect(launchRes);

      const detailRes = await api.getSession(id);
      expect(detailRes.text).toContain("manual");
    });

    it("htmx request returns 204 with HX-Redirect header", async () => {
      const res = await api.agent
        .post("/agents/run")
        .set("hx-request", "true")
        .send({ task: "htmx test" });

      expect(res.status).toBe(204);
      expect(res.headers["hx-redirect"]).toMatch(/\/agents\/[^/]+$/);
    });
  });

  describe("GET /agents/:id — events", () => {
    it("renders streamed events on the detail page", async () => {
      const launchRes = await api.launch({ task: "log stream" });
      const id = api.getSessionIdFromRedirect(launchRes);

      api.sendEvent({ type: "turn_start" });
      api.sendEvent({
        type: "message_end",
        message: { role: "assistant", content: "Hello from agent" },
      });
      api.sendEvent({
        type: "tool_start",
        toolCallId: "call_1",
        toolName: "bash",
        args: { command: "echo ok" },
      });
      api.sendEvent({
        type: "tool_end",
        toolCallId: "call_1",
        toolName: "bash",
        result: "ok",
        isError: false,
      });
      api.sendEvent({ type: "agent_settled" });

      const detailRes = await api.getSession(id);
      const parsed = api.parseSessionDetail(detailRes);

      expect(parsed.showLogs).toContain("Hello from agent");
      expect(parsed.showLogs).toContain("Turn 1");
      expect(parsed.showLogs).toContain("bash");
    });

    it("transitions to idle after agent settles", async () => {
      const launchRes = await api.launch({ task: "settle" });
      const id = api.getSessionIdFromRedirect(launchRes);

      api.sendEvent({ type: "agent_settled" });

      const detailRes = await api.getSession(id);
      const parsed = api.parseSessionDetail(detailRes);

      expect(parsed.status).toBe("idle");
    });

    it("returns article-only when hx-request header is set", async () => {
      const launchRes = await api.launch({ task: "htmx card" });
      const id = api.getSessionIdFromRedirect(launchRes);

      const fullRes = await api.getSession(id);
      expect(fullRes.text).toContain("<html");
      expect(fullRes.text).toContain("<body");

      const htmxRes = await api.agent.get(`/agents/${id}`).set("hx-request", "true");
      expect(htmxRes.status).toBe(200);
      expect(htmxRes.text).not.toContain("<html");
      expect(htmxRes.text).not.toContain("<body");
      expect(htmxRes.text).toContain("<article");
    });
  });

  describe("manual permission policy — waiting for input", () => {
    it("pauses on a dialog and resumes on respond", async () => {
      const launchRes = await api.launch({ task: "manual", permissionPolicy: "manual" });
      const id = api.getSessionIdFromRedirect(launchRes);

      api.sendEvent({
        type: "waiting_for_input",
        requestId: "req-1",
        method: "confirm",
        prompt: "Clear session?",
      });

      let detailRes = await api.getSession(id);
      let parsed = api.parseSessionDetail(detailRes);
      expect(parsed.status).toBe("waiting_for_input");

      const respondRes = await api.agent
        .post(`/api/sessions/${id}/respond`)
        .send({ requestId: "req-1", confirmed: true });
      expect(respondRes.status).toBe(200);

      detailRes = await api.getSession(id);
      parsed = api.parseSessionDetail(detailRes);
      expect(parsed.status).toBe("running");
    });

    it("auto-answers dialogs when policy is auto", async () => {
      const launchRes = await api.launch({ task: "auto" });
      const id = api.getSessionIdFromRedirect(launchRes);

      api.sendEvent({
        type: "waiting_for_input",
        requestId: "req-1",
        method: "confirm",
        prompt: "Proceed?",
      });

      await new Promise((r) => setTimeout(r, 10));

      const handle = api.fakeHarness.handles[0];
      expect(handle.responded.length).toBe(1);
      expect(handle.responded[0].requestId).toBe("req-1");
      expect(handle.responded[0].value).toEqual({ confirmed: true });

      const detailRes = await api.getSession(id);
      const parsed = api.parseSessionDetail(detailRes);
      expect(parsed.status).toBe("running");
    });
  });

  describe("kill", () => {
    it("stops the session and removes the container", async () => {
      const launchRes = await api.launch({ task: "kill me" });
      const id = api.getSessionIdFromRedirect(launchRes);

      const killRes = await api.killSession(id);
      expect(killRes.status).toBe(302);

      const detailRes = await api.getSession(id);
      const parsed = api.parseSessionDetail(detailRes);
      expect(parsed.status).toBe("stopped");
      expect(parsed.hasKillButton).toBe(false);
      expect(api.mockDocker.removed.length).toBe(1);
    });

    it("htmx card refresh does not show kill button when session is stopped", async () => {
      const launchRes = await api.launch({ task: "done card" });
      const id = api.getSessionIdFromRedirect(launchRes);

      await api.killSession(id);

      const htmxRes = await api.agent.get(`/agents/${id}`).set("hx-request", "true");
      expect(htmxRes.text).not.toContain("Kill Session");
    });
  });

  describe("API — liveness and validation", () => {
    it("rejects prompt on a stopped session with 409", async () => {
      const launchRes = await api.launch({ task: "kill me" });
      const id = api.getSessionIdFromRedirect(launchRes);

      await api.killSession(id);

      const res = await api.agent.post(`/api/sessions/${id}/prompt`).send({ message: "again" });
      expect(res.status).toBe(409);
    });

    it("rejects prompt on an unknown session with 404", async () => {
      const res = await api.agent.post("/api/sessions/doesnotexist/prompt").send({ message: "hi" });
      expect(res.status).toBe(404);
    });

    it("returns 404 when deleting an unknown session", async () => {
      const res = await api.agent.delete("/api/sessions/doesnotexist");
      expect(res.status).toBe(404);
    });

    it("rejects respond without exactly one payload field with 400", async () => {
      const launchRes = await api.launch({ task: "manual", permissionPolicy: "manual" });
      const id = api.getSessionIdFromRedirect(launchRes);

      const res = await api.agent.post(`/api/sessions/${id}/respond`).send({ requestId: "r1" });
      expect(res.status).toBe(400);
    });

    it("coerces an invalid permissionPolicy to auto", async () => {
      const res = await api.agent.post("/api/sessions").send({ permissionPolicy: "bogus" });
      expect(res.status).toBe(201);
      const id = res.body.session.id;

      const getRes = await api.agent.get(`/api/sessions/${id}`);
      expect(getRes.body.session.permissionPolicy).toBe("auto");
    });

    it("forwards prompt behavior when given", async () => {
      const launchRes = await api.launch({ task: "steer me" });
      const id = api.getSessionIdFromRedirect(launchRes);

      const res = await api.agent
        .post(`/api/sessions/${id}/prompt`)
        .send({ message: "turn left", behavior: "steer" });
      expect(res.status).toBe(202);

      const handle = api.handle();
      expect(handle.prompts[handle.prompts.length - 1]).toBe("turn left");
      expect(handle.promptBehaviors[handle.promptBehaviors.length - 1]).toBe("steer");
    });

    it("omits behavior when not provided", async () => {
      const launchRes = await api.launch({ task: "plain" });
      const id = api.getSessionIdFromRedirect(launchRes);

      await api.agent.post(`/api/sessions/${id}/prompt`).send({ message: "hello" });

      const handle = api.handle();
      expect(handle.promptBehaviors[handle.promptBehaviors.length - 1]).toBeUndefined();
    });

    it("rejects an invalid prompt behavior with 400", async () => {
      const launchRes = await api.launch({ task: "bad behavior" });
      const id = api.getSessionIdFromRedirect(launchRes);

      const res = await api.agent
        .post(`/api/sessions/${id}/prompt`)
        .send({ message: "hi", behavior: "yell" });
      expect(res.status).toBe(400);
    });
  });

  describe("API — SSE event stream", () => {
    function openSse(id: string) {
      const chunks: string[] = [];
      const req = request(api.app)
        .get(`/api/sessions/${id}/events`)
        .buffer(false)
        .parse((res, cb) => {
          res.on("data", (d: Buffer) => chunks.push(d.toString()));
          res.on("end", () => cb(null, ""));
        });

      const opened = new Promise<{ headers: Record<string, string>; destroy: () => void }>(
        (resolve, reject) => {
          req.on("response", (res) => {
            resolve({ headers: res.headers as Record<string, string>, destroy: () => res.destroy() });
          });
          req.on("error", reject);
        }
      );
      req.end(() => {});

      return {
        opened,
        lines: () => chunks.join("").split("\n"),
        waitFor: async (predicate: (lines: string[]) => boolean, timeoutMs = 2000) => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            if (predicate(chunks.join("").split("\n"))) return;
            await new Promise((r) => setTimeout(r, 10));
          }
          throw new Error("timed out waiting for SSE output");
        },
      };
    }

    it("disables edge proxy buffering", async () => {
      const launchRes = await api.launch({ task: "no buffering" });
      const id = api.getSessionIdFromRedirect(launchRes);

      const stream = openSse(id);
      const { headers, destroy } = await stream.opened;

      expect(headers["x-accel-buffering"]).toBe("no");
      expect(headers["content-type"]).toContain("text/event-stream");
      destroy();
    });

    it("replays history and keeps heartbeating while idle", async () => {
      const launchRes = await api.launch({ task: "heartbeat" });
      const id = api.getSessionIdFromRedirect(launchRes);
      api.sendEvent({ type: "turn_start" });
      api.sendEvent({
        type: "message_end",
        message: { role: "assistant", content: "replayed" },
      });
      api.sendEvent({ type: "agent_settled" });

      const stream = openSse(id);
      const { destroy } = await stream.opened;

      await stream.waitFor((lines) => lines.some((l) => l.includes("replayed")));
      await stream.waitFor((lines) => lines.some((l) => l === ": ping"));

      destroy();
    });

    it("delivers live events exactly once after replay", async () => {
      const launchRes = await api.launch({ task: "exactly once" });
      const id = api.getSessionIdFromRedirect(launchRes);
      api.sendEvent({ type: "agent_settled" });

      const stream = openSse(id);
      const { destroy } = await stream.opened;

      await stream.waitFor((lines) => lines.some((l) => l.includes("agent_settled")));

      api.sendEvent({ type: "tool_start", toolCallId: "c1", toolName: "bash", args: {} });
      await stream.waitFor((lines) => lines.filter((l) => l.includes('"toolName":"bash"')).length === 1);
      await new Promise((r) => setTimeout(r, 50));

      const occurrences = stream.lines().filter((l) => l.includes('"toolName":"bash"')).length;
      expect(occurrences).toBe(1);

      destroy();
    });

    it("ends with agent-done after the session is stopped", async () => {
      const launchRes = await api.launch({ task: "kill stream" });
      const id = api.getSessionIdFromRedirect(launchRes);
      await api.killSession(id);

      const res = await request(api.app).get(`/api/sessions/${id}/events`);

      expect(res.status).toBe(200);
      expect(res.text).toContain("agent-done");
      expect(res.text).toContain('{"status":"stopped"}');
    });
  });
});
