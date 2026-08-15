import * as cheerio from "cheerio";
import request from "supertest";
import { createAgentTestApp, MockDockerPort, FakeHarness, FakeHandle } from "./setup.js";

type Agent = ReturnType<typeof request.agent>;

export class AgentsApi {
  agent: Agent;
  mockDocker: MockDockerPort;
  fakeHarness: FakeHarness;

  constructor() {
    const { app, mockDocker, fakeHarness } = createAgentTestApp();
    this.mockDocker = mockDocker;
    this.fakeHarness = fakeHarness;
    this.agent = request.agent(app);
  }

  handle(): FakeHandle {
    const h = this.fakeHarness.handles[this.fakeHarness.handles.length - 1];
    if (!h) throw new Error("No harness handle started");
    return h;
  }

  reset() {
    this.mockDocker.reset();
    this.fakeHarness.reset();
  }

  sendEvent(event: Record<string, unknown>) {
    this.handle().emit(event as never);
  }

  async openList() {
    return this.agent.get("/agents");
  }

  async openNew() {
    return this.agent.get("/agents/new");
  }

  async launch(params: {
    task?: string;
    connectors?: string | string[];
    model?: string;
    permissionPolicy?: string;
  }) {
    const body: Record<string, string> = {};
    if (params.task !== undefined) body.task = params.task;
    if (params.connectors) {
      body.connectors = Array.isArray(params.connectors)
        ? params.connectors.join(",")
        : params.connectors;
    }
    if (params.model) body.model = params.model;
    if (params.permissionPolicy) body.permissionPolicy = params.permissionPolicy;

    return this.agent.post("/agents/run").send(body);
  }

  async getSession(id: string) {
    return this.agent.get(`/agents/${id}`);
  }

  async killSession(id: string) {
    return this.agent.post(`/agents/${id}/kill`);
  }

  async getStatusBadge(id: string) {
    return this.agent.get(`/agents/${id}/status-badge`);
  }

  getSessionIdFromRedirect(res: request.Response): string {
    const location = res.headers.location;
    if (!location) throw new Error("No redirect location");
    const match = location.match(/\/agents\/([^/]+)/);
    if (!match) throw new Error(`Could not extract session ID from ${location}`);
    return match[1];
  }

  parseSessionDetail(res: request.Response) {
    const $ = cheerio.load(res.text);
    const pageText = $("article").text();

    const statusMark = $("span#status-badge mark");
    const status = statusMark.text().trim();

    const killButton = $("footer a").filter((_, el) => $(el).text().includes("Kill Session"));
    const hasKillButton = killButton.length > 0;

    const showLogs = $("#log-container").html() || "";

    return { pageText, status, hasKillButton, showLogs, $ };
  }
}
