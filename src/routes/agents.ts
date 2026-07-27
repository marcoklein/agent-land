import { Router } from "express";
import { AgentRunner } from "../services/agent-runner.js";
import { SopsService } from "../services/sops.js";
import { DockerService } from "../services/docker.js";
import { buildPrompt } from "../services/prompt.js";
import { renderLogEntry } from "../services/log-renderer.js";
import { getConfig } from "../config.js";
import { readFile } from "fs/promises";
import { Connector } from "../types.js";

const config = getConfig();

export function agentsRouter(sops: SopsService) {
  const docker = new DockerService(
    process.env.DOCKER_SOCKET || "/var/run/docker.sock"
  );
  const runner = new AgentRunner(sops, docker);
  const router = Router();

  router.get("/", async (req, res) => {
    const runs = await runner.listRuns();
    res.render("layout", { view: "agents/list", currentPage: "agents", runs });
  });

  router.get("/new", async (req, res) => {
    const connectors = await loadConnectors();
    res.render("layout", { view: "agents/new", currentPage: "new-agent", connectors });
  });

  router.post("/run", async (req, res) => {
    const { task, connectors, model } = req.body;
    const connectorList: string[] = Array.isArray(connectors)
      ? connectors
      : connectors ? [connectors] : [];

    try {
      const allConnectors = await loadConnectors();
      const selected = allConnectors.filter(c => connectorList.includes(c.name));
      const prompt = buildPrompt(task, selected);
      const run = await runner.launch({ task: prompt, connectors: connectorList, model });
      res.header("HX-Redirect", `/agents/${run.id}`);
      res.status(204).end();
    } catch (err: any) {
      req.flash("error", `Launch failed: ${err.message}`);
      res.header("HX-Redirect", "/agents/new");
      res.status(204).end();
    }
  });

  router.get("/:id", async (req, res) => {
    const run = await runner.getRun(req.params.id);
    if (!run) {
      req.flash("error", "Agent run not found.");
      return res.redirect("/agents");
    }
    res.render("layout", { view: "agents/show", currentPage: "agents", run });
  });

  router.get("/:id/logs", async (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sseWrite = (data: string) => {
      res.write(`data: ${data.replace(/\n/g, "\ndata: ")}\n\n`);
    };

    const runId = req.params.id;
    let lastLogCount = 0;

    const sendNewLogs = async () => {
      const run = await runner.getRun(runId);
      if (!run) {
        sseWrite(`<div class="log-error">Agent run not found</div>`);
        res.write(`event: agent-done\ndata: {}\n\n`);
        res.end();
        return true;
      }

      const newLogs = run.logs.slice(lastLogCount);
      for (const log of newLogs) {
        const html = renderLogEntry(log.data);
        if (html) {
          sseWrite(html);
        }
      }
      lastLogCount = run.logs.length;

      if (run.status !== "running") {
        res.write(`event: agent-done\ndata: {"status":"${run.status}","exitCode":${run.exitCode ?? -1}}\n\n`);
        res.end();
        return true;
      }

      return false;
    };

    const done = await sendNewLogs();
    if (done) return;

    const poll = setInterval(async () => {
      try {
        const finished = await sendNewLogs();
        if (finished) clearInterval(poll);
      } catch {
        clearInterval(poll);
        res.end();
      }
    }, 2000);

    req.on("close", () => clearInterval(poll));
  });

  router.get("/:id/status-badge", async (req, res) => {
    const run = await runner.getRun(req.params.id);
    if (!run) return res.send(`<mark>not found</mark>`);
    const cls = run.status === "running" ? "" : run.status === "completed" ? "pico-color-jade-100" : "pico-color-red-100";
    res.send(`<mark id="status-badge" class="${cls}">${run.status}</mark>`);
  });

  return router;
}

async function loadConnectors(): Promise<Connector[]> {
  try {
    const content = await readFile(`${config.dataDir}/connectors.json`, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}
