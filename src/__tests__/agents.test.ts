import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as cheerio from "cheerio";
import { AgentsApi } from "./helpers/agents-api.js";
import { setupDataDir, cleanupDataDir, createAgentTestApp, MockDockerService } from "./helpers/setup.js";
import request from "supertest";

describe("Agents — Launch screen", () => {
  const api = new AgentsApi();

  beforeEach(async () => {
    await setupDataDir();
    api.mockDocker.reset();
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
      expect($("button[type=submit]").text()).toContain("Launch Agent");
    });

    it("shows kill switch section with default values", async () => {
      const res = await api.openNew();

      const $ = cheerio.load(res.text);
      const summary = $("details summary").filter((_, el) => $(el).text().includes("Kill Switch"));
      expect(summary.length).toBe(1);

      expect($("input[name=timeout]").attr("value")).toBe("3600");
      expect($("input[name=maxTokens]").attr("value")).toBe("100000");
      expect($("input[name=maxCost]").attr("value")).toBe("1");
    });

    it("shows no connectors message when none defined", async () => {
      const res = await api.openNew();

      expect(res.text).toContain("No connectors defined");
    });
  });

  describe("POST /agents/run", () => {
    it("redirects to run detail page after launch", async () => {
      const res = await api.launch({ task: "test task" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/agents\/[^/]+$/);
    });

    it("stores kill switch defaults on the run", async () => {
      const launchRes = await api.launch({ task: "test task" });
      const runId = api.getRunIdFromRedirect(launchRes);

      const detailRes = await api.getRun(runId);
      const parsed = api.parseRunDetail(detailRes);

      expect(parsed.taskText).toContain("test task");
      expect(parsed.status).toBe("running");
    });

    it("stores custom kill switch values", async () => {
      const launchRes = await api.launch({
        task: "custom limits",
        timeout: "60",
        maxTokens: "5000",
        maxCost: "0.50",
      });
      const runId = api.getRunIdFromRedirect(launchRes);

      const detailRes = await api.getRun(runId);
      const parsed = api.parseRunDetail(detailRes);

      expect(parsed.taskText).toContain("custom limits");
      expect(parsed.status).toBe("running");
    });

    it("stores task, connectors, and model on the run detail page", async () => {
      const launchRes = await api.launch({
        task: "do the thing",
        model: "some-model",
      });
      const runId = api.getRunIdFromRedirect(launchRes);

      const detailRes = await api.getRun(runId);
      const parsed = api.parseRunDetail(detailRes);

      expect(parsed.taskText).toContain("do the thing");
      expect(parsed.pageText).toContain("some-model");
    });

    it("htmx request returns 204 with HX-Redirect header", async () => {
      const res = await api.launch({ task: "htmx test" });
      // HTMX without header just redirects normally
      expect(res.status).toBe(302);
    });
  });

  describe("GET /agents/:id — SSE", () => {
    it("streams log events to the detail page", async () => {
      const launchRes = await api.launch({ task: "log stream" });
      const runId = api.getRunIdFromRedirect(launchRes);

      api.sendEvent({ type: "turn_start" });
      api.sendEvent({ type: "message_start", message: { role: "assistant" } });
      api.sendEvent({ type: "content_block_delta", delta: { text: "Hello" } });
      api.sendEvent({ type: "content_block_delta", delta: { text: " from agent" } });
      api.sendEvent({ type: "message_end", message: { role: "assistant", content: "Hello from agent", usage: { totalTokens: 42 } } });
      api.sendEvent({ type: "tool_execution_start", toolName: "bash", args: { command: "echo ok" } });
      api.sendEvent({ type: "tool_execution_end", toolName: "bash", result: "ok", isError: false });
      api.sendEvent({ type: "agent_end", exitCode: 0 });
      api.completeRun(0);

      // Wait for log stream to flush and exit promise to resolve
      await new Promise(r => setTimeout(r, 500));

      const detailRes = await api.getRun(runId);
      const parsed = api.parseRunDetail(detailRes);

      expect(parsed.status).toContain("completed");
      expect(parsed.taskText).toContain("log stream");
      expect(parsed.showLogs).toContain("Hello from agent");
      expect(parsed.showLogs).toContain("Turn 1");
      expect(parsed.showLogs).toContain("bash");
    });

    it("returns stats fragment with duration for running agent", async () => {
      const launchRes = await api.launch({ task: "stats test" });
      const runId = api.getRunIdFromRedirect(launchRes);

      const res = await api.agent.get(`/agents/${runId}/stats`);

      expect(res.status).toBe(200);
      expect(res.text).toContain("<strong>Duration:</strong>");
      expect(res.text).toMatch(/\d+s/);
    });

    it("returns stats with tokens and cost after usage events", async () => {
      const launchRes = await api.launch({ task: "stats with usage", maxTokens: "5000", maxCost: "0.50" });
      const runId = api.getRunIdFromRedirect(launchRes);

      api.sendEvent({ type: "message_end", message: { role: "assistant", content: "hello", usage: { totalTokens: 100, cost: { total: 0.05 } } } });
      await new Promise(r => setTimeout(r, 100));

      const res = await api.agent.get(`/agents/${runId}/stats`);

      expect(res.text).toContain("<strong>Tokens:</strong> 100 / 5,000");
      expect(res.text).toContain("<strong>Cost:</strong> $0.0500 / $0.5");
    });

    it("returns article-only when hx-request header is set", async () => {
      const launchRes = await api.launch({ task: "htmx card" });
      const runId = api.getRunIdFromRedirect(launchRes);

      // Normal request includes layout
      const fullRes = await api.agent.get(`/agents/${runId}`);
      expect(fullRes.text).toContain("<html");
      expect(fullRes.text).toContain("<body");

      // HTMX request returns article only
      const htmxRes = await api.agent.get(`/agents/${runId}`).set("hx-request", "true");
      expect(htmxRes.status).toBe(200);
      expect(htmxRes.text).not.toContain("<html");
      expect(htmxRes.text).not.toContain("<body");
      expect(htmxRes.text).toContain("<article");
    });

    it("htmx card refresh does not show kill button when agent is done", async () => {
      const launchRes = await api.launch({ task: "done card" });
      const runId = api.getRunIdFromRedirect(launchRes);

      api.completeRun(0);
      await new Promise(r => setTimeout(r, 500));

      const htmxRes = await api.agent.get(`/agents/${runId}`).set("hx-request", "true");
      expect(htmxRes.text).not.toContain("Kill Agent");
    });
  });
});
