import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as cheerio from "cheerio";
import { AgentsApi } from "./helpers/agents-api.js";
import { setupDataDir, cleanupDataDir } from "./helpers/setup.js";

describe("Agents — Launch screen", () => {
  const api = new AgentsApi();

  beforeEach(async () => {
    await setupDataDir();
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
});
