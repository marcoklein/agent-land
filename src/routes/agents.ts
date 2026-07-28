import { Router } from "express";
import { readFile } from "fs/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { AgentRunner } from "../services/agent-runner.js";
import { SopsService } from "../services/sops.js";
import { DockerService } from "../services/docker.js";
import { buildPrompt } from "../services/prompt.js";
import { renderLogEntry, renderLogEntryFull } from "../services/log-renderer.js";
import { getConfig } from "../config.js";
import { Connector, LogEntry } from "../types.js";
import path from "path";

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

    const isHtmx = !!req.headers["hx-request"];

    try {
      const allConnectors = await loadConnectors();
      const selected = allConnectors.filter(c => connectorList.includes(c.name));
      const prompt = buildPrompt(task, selected);
      const run = await runner.launch({ task: prompt, connectors: connectorList, model });
      if (isHtmx) {
        res.header("HX-Redirect", `/agents/${run.id}`);
        res.status(204).end();
      } else {
        res.redirect(`/agents/${run.id}`);
      }
    } catch (err: any) {
      if (isHtmx) {
        res.header("HX-Redirect", "/agents/new");
        res.status(204).end();
      } else {
        req.flash("error", `Launch failed: ${err.message}`);
        res.redirect("/agents/new");
      }
    }
  });

  router.get("/:id", async (req, res) => {
    const run = await runner.getRun(req.params.id);
    if (!run) {
      req.flash("error", "Agent run not found.");
      return res.redirect("/agents");
    }

    let turnCount = 0;
    const renderedLogs: string[] = [];
    for (let i = 0; i < run.logs.length; i++) {
      const result = renderLogEntry(run.logs[i].data, turnCount, i, run.id);
      turnCount = result.turnCount;
      if (result.html) renderedLogs.push(result.html);
    }

    res.render("layout", {
      view: "agents/show",
      currentPage: "agents",
      run,
      renderedLogs,
      totalLogCount: run.logs.length,
    });
  });

  router.get("/:id/logs", async (req, res) => {
    const afterIndex = req.query.after ? parseInt(req.query.after as string, 10) : 0;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sseWrite = (data: string) => {
      res.write(`data: ${data.replace(/\n/g, "\ndata: ")}\n\n`);
    };

    const runId = req.params.id;
    const logPath = path.join(config.dataDir, "logs", `${runId}.jsonl`);
    let turnCount = 0;
    let lastIndex = afterIndex;

    const sendNewLogs = async (): Promise<boolean> => {
      try {
        const content = await readFile(logPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);

        if (lastIndex >= lines.length) {
          const run = await runner.getRun(runId);
          if (!run || run.status !== "running") {
            res.write(`event: agent-done\ndata: {"status":"${run?.status ?? "unknown"}","exitCode":${run?.exitCode ?? -1}}\n\n`);
            res.end();
            return true;
          }
          return false;
        }

        for (let i = lastIndex; i < lines.length; i++) {
          try {
            const entry = JSON.parse(lines[i]);
            const result = renderLogEntry(entry.data, turnCount, i, runId);
            turnCount = result.turnCount;
            if (result.html) {
              sseWrite(result.html);
            }
          } catch {}
        }
        lastIndex = lines.length;

        const run = await runner.getRun(runId);
        if (!run || run.status !== "running") {
          sseWrite(`<div class="run-completed">Agent ${run?.status ?? "unknown"} (exit code: ${run?.exitCode ?? -1})</div>`);
          res.write(`event: agent-done\ndata: {"status":"${run?.status ?? "unknown"}","exitCode":${run?.exitCode ?? -1}}\n\n`);
          res.end();
          return true;
        }
        return false;
      } catch {
        return false;
      }
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

  router.get("/:id/log-entry/:index", async (req, res) => {
    const entryIndex = parseInt(req.params.index, 10);
    const runId = req.params.id;
    const logPath = path.join(config.dataDir, "logs", `${runId}.jsonl`);

    try {
      const entry = await readLogEntry(logPath, entryIndex);
      if (!entry) {
        return res.status(404).send("Entry not found");
      }
      const html = renderLogEntryFull(entry.data);
      res.send(html ?? "");
    } catch {
      res.status(500).send("Failed to read log entry");
    }
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

async function readLogEntry(filePath: string, index: number): Promise<LogEntry | null> {
  const rl = createInterface({
    input: createReadStream(filePath),
  });
  let i = 0;
  for await (const line of rl) {
    if (i === index) {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }
    i++;
  }
  return null;
}
