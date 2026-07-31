import * as cheerio from "cheerio";
import request from "supertest";
import { createAgentTestApp, MockDockerService } from "./setup.js";

type Agent = ReturnType<typeof request.agent>;

export class AgentsApi {
  agent: Agent;
  mockDocker: MockDockerService;

  constructor() {
    this.mockDocker = new MockDockerService();
    const app = createAgentTestApp(this.mockDocker);
    this.agent = request.agent(app);
  }

  sendEvent(event: Record<string, unknown>) {
    this.mockDocker.logStream.write(JSON.stringify(event) + "\n");
  }

  completeRun(exitCode = 0) {
    this.mockDocker.logStream.end();
    this.mockDocker.resolveExit(exitCode);
  }

  async openList() {
    return this.agent.get("/agents");
  }

  async openNew() {
    return this.agent.get("/agents/new");
  }

  async launch(params: {
    task: string;
    connectors?: string | string[];
    model?: string;
    timeout?: string;
    maxTokens?: string;
    maxCost?: string;
  }) {
    const body: Record<string, string> = { task: params.task };
    if (params.connectors) {
      if (Array.isArray(params.connectors)) {
        body.connectors = params.connectors.join(",");
      } else {
        body.connectors = params.connectors;
      }
    }
    if (params.model) body.model = params.model;
    if (params.timeout !== undefined) body.timeout = params.timeout;
    if (params.maxTokens !== undefined) body.maxTokens = params.maxTokens;
    if (params.maxCost !== undefined) body.maxCost = params.maxCost;

    return this.agent.post("/agents/run").send(body);
  }

  async launchAndFollow(params: { task: string; connectors?: string[]; model?: string; timeout?: string; maxTokens?: string; maxCost?: string }) {
    const res = await this.launch(params);
    const location = res.headers.location;
    if (!location) throw new Error("No redirect location after launch");
    return this.agent.get(location);
  }

  async getRun(id: string) {
    return this.agent.get(`/agents/${id}`);
  }

  async killRun(id: string) {
    return this.agent.post(`/agents/${id}/kill`);
  }

  async getStatusBadge(id: string) {
    return this.agent.get(`/agents/${id}/status-badge`);
  }

  getRunIdFromRedirect(res: request.Response): string {
    const location = res.headers.location;
    if (!location) throw new Error("No redirect location");
    const match = location.match(/\/agents\/([^/]+)/);
    if (!match) throw new Error(`Could not extract run ID from ${location}`);
    return match[1];
  }

  parseRunDetail(res: request.Response) {
    const $ = cheerio.load(res.text);
    const pageText = $("article").text();

    const statusMark = $("span#status-badge mark");
    const status = statusMark.text().trim();

    const taskText = $("details pre").text().trim();

    const killButton = $("footer button").filter((_, el) => $(el).text().includes("Kill Agent"));
    const hasKillButton = killButton.length > 0;

    const showLogs = $("#log-container").html() || "";

    return { pageText, status, taskText, hasKillButton, showLogs, $ };
  }

  parseRunList(res: request.Response) {
    const $ = cheerio.load(res.text);
    const rows: { id: string; status: string; statusClass: string }[] = [];
    $("tbody tr").each((_, row) => {
      const tds = $(row).find("td");
      const id = $(tds[0]).find("code").text().trim();
      const mark = $(tds[3]).find("mark");
      rows.push({
        id,
        status: mark.text().trim(),
        statusClass: mark.attr("class") || "",
      });
    });
    return { rows, $ };
  }
}
