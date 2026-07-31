import * as cheerio from "cheerio";
import request from "supertest";
import { createTestApp } from "./setup.js";

export interface CreateConnectorParams {
  name: string;
  type: "jira" | "github" | "gmail" | "custom";
  url: string;
  fields?: Record<string, string>;
  content?: string;
}

export class ConnectorsApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any;

  constructor() {
    const app = createTestApp();
    this.agent = request.agent(app);
  }

  async openList() {
    return this.agent.get("/connectors");
  }

  async openNewForm() {
    return this.agent.get("/connectors/new");
  }

  async create(params: CreateConnectorParams) {
    const body: Record<string, string> = {
      name: params.name,
      type: params.type,
      url: params.url,
    };
    if (params.type !== "custom" && params.fields) {
      Object.assign(body, params.fields);
    } else if (params.content !== undefined) {
      body.content = params.content;
    }
    return this.agent.post("/connectors").send(body);
  }

  async createHtmx(params: CreateConnectorParams) {
    const body: Record<string, string> = {
      name: params.name,
      type: params.type,
      url: params.url,
    };
    if (params.type !== "custom" && params.fields) {
      Object.assign(body, params.fields);
    } else if (params.content !== undefined) {
      body.content = params.content;
    }
    return this.agent
      .post("/connectors")
      .set("hx-request", "true")
      .send(body);
  }

  async delete(name: string) {
    return this.agent.post(`/connectors/${name}/delete`);
  }

  async deleteHtmx(name: string) {
    return this.agent
      .post(`/connectors/${name}/delete`)
      .set("hx-request", "true");
  }

  async getListConnectors() {
    const res = await this.openList();
    const $ = cheerio.load(res.text);
    const rows: { name: string; type: string; url: string; secretFile: string }[] = [];
    $("tbody tr").each((_, row) => {
      const tds = $(row).find("td");
      rows.push({
        name: $(tds[0]).text().trim(),
        type: $(tds[1]).text().trim(),
        url: $(tds[2]).text().trim(),
        secretFile: $(tds[3]).text().trim(),
      });
    });
    return rows;
  }

  async getFlashMessages() {
    const res = await this.openList();
    const $ = cheerio.load(res.text);
    const messages: { type: string; text: string }[] = [];
    $(".flash-message, [data-flash]").each((_, el) => {
      messages.push({
        type: $(el).attr("class") || "",
        text: $(el).text().trim(),
      });
    });
    return messages;
  }

  /** Returns text content of error/success messages in the page */
  async getMessages() {
    const res = await this.openList();
    const $ = cheerio.load(res.text);
    const messages: string[] = [];
    $("mark.pico-color-red-100, mark.pico-color-jade-100, .flash-message").each((_, el) => {
      messages.push($(el).text().trim());
    });
    return messages;
  }

  /** Check if a connector name appears in the list page */
  async connectorExists(name: string) {
    const connectors = await this.getListConnectors();
    return connectors.some((c) => c.name === name);
  }
}
