import { describe, it, expect, beforeEach, afterAll } from "vitest";
import path from "path";
import { stat } from "fs/promises";
import * as cheerio from "cheerio";
import { ConnectorsApi } from "./helpers/connectors-api.js";
import { setupDataDir, cleanupDataDir } from "./helpers/setup.js";
import { getConfig } from "../config.js";

const config = getConfig();

describe("Connectors", () => {
  const api = new ConnectorsApi();

  beforeEach(async () => {
    await setupDataDir();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  const githubCreds = {
    name: "GitHub Personal",
    type: "github" as const,
    url: "https://api.github.com",
    fields: { GITHUB_TOKEN: "ghp_test123" },
  };

  const jiraCreds = {
    name: "Work Jira",
    type: "jira" as const,
    url: "https://example.atlassian.net",
    fields: { JIRA_EMAIL: "test@example.com", JIRA_API_TOKEN: "test-token" },
  };

  // --- List page ---

  it("shows empty state when no connectors exist", async () => {
    const res = await api.openList();

    expect(res.status).toBe(200);
    expect(res.text).toContain("Connectors");
    expect(res.text).toContain("No connectors yet");
  });

  it("lists created connectors", async () => {
    await api.create(githubCreds);
    await api.create(jiraCreds);

    const connectors = await api.getListConnectors();
    expect(connectors).toHaveLength(2);

    const github = connectors.find((c) => c.name === "GitHub Personal")!;
    expect(github).toBeDefined();
    expect(github.type).toBe("github");
    expect(github.url).toBe("https://api.github.com");
    expect(github.secretFile).toBe("github-personal.yaml");
  });

  // --- New form ---

  it("renders new connector form", async () => {
    const res = await api.openNewForm();

    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    expect($("input#name").length).toBe(1);
    expect($("select#type").length).toBe(1);
    expect($("input#url").length).toBe(1);
    expect($("div#secret-fields").length).toBe(1);
    expect($("button[type=submit]").text()).toContain("Create");
  });

  // --- Create ---

  it("creates a connector and encrypts the secret file", async () => {
    const res = await api.create(githubCreds);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/connectors");

    expect(await api.connectorExists("GitHub Personal")).toBe(true);

    const secretPath = path.join(config.secretsDir, "github-personal.yaml");
    await expect(stat(secretPath)).resolves.toBeDefined();
  });

  it("shows success flash after creation", async () => {
    await api.create(githubCreds);

    const listRes = await api.openList();

    expect(listRes.text).toContain("GitHub Personal");
    const $ = cheerio.load(listRes.text);
    expect($("ins").text()).toContain('"GitHub Personal" created');
  });

  it("shows error when fields are missing", async () => {
    const res = await api.create({
      name: "",
      type: "github" as const,
      url: "",
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/connectors/new");

    const formRes = await api.agent.get("/connectors/new");
    const $ = cheerio.load(formRes.text);
    expect($("del").text()).toContain("Name, type, and URL are required");
  });

  it("rejects duplicate connector names", async () => {
    await api.create(githubCreds);

    const res = await api.create({
      ...githubCreds,
      url: "https://different.url",
      fields: { GITHUB_TOKEN: "different" },
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/connectors/new");

    const formRes = await api.agent.get("/connectors/new");
    const $ = cheerio.load(formRes.text);
    expect($("del").text()).toContain("already exists");
  });

  // --- HTMX create ---

  it("HTMX create returns redirect header with no body", async () => {
    const res = await api.createHtmx(githubCreds);

    expect(res.status).toBe(204);
    expect(res.headers["hx-redirect"]).toBe("/connectors");
  });

  // --- Delete ---

  it("deletes a connector and removes its secret file", async () => {
    await api.create(githubCreds);
    expect(await api.connectorExists("GitHub Personal")).toBe(true);

    const res = await api.delete("GitHub Personal");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/connectors");

    expect(await api.connectorExists("GitHub Personal")).toBe(false);

    const secretPath = path.join(config.secretsDir, "github-personal.yaml");
    await expect(stat(secretPath)).rejects.toThrow();
  });

  it("HTMX delete returns empty body for row swap removal", async () => {
    await api.create(githubCreds);

    const res = await api.deleteHtmx("GitHub Personal");

    expect(res.status).toBe(200);
    expect(res.text).toBe("");
    expect(await api.connectorExists("GitHub Personal")).toBe(false);
  });

  it("shows success flash after non-HTMX delete", async () => {
    await api.create(githubCreds);
    await api.create(jiraCreds);

    await api.delete("GitHub Personal");

    const listRes = await api.openList();
    const $ = cheerio.load(listRes.text);
    expect($("ins").text()).toContain("deleted");
  });

  // --- Secret file naming ---

  it("slugifies connector name for secret file", async () => {
    await api.create({
      name: "My GitHub (All Repos!)",
      type: "github" as const,
      url: "https://api.github.com",
      fields: { GITHUB_TOKEN: "test" },
    });

    const secretPath = path.join(config.secretsDir, "my-github-all-repos.yaml");
    await expect(stat(secretPath)).resolves.toBeDefined();
  });
});
