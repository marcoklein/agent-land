import { randomUUID } from "crypto";
import { readFile, writeFile, stat, mkdir, readdir } from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import readline from "readline";
import { AgentRun, AgentRunWithLogs, LogEntry, Connector } from "../types.js";
import { SopsService } from "./sops.js";
import { DockerService } from "./docker.js";
import { getConfig } from "../config.js";

const config = getConfig();

export class AgentRunner {
  constructor(
    private sops: SopsService,
    private docker: DockerService
  ) {}

  async launch(options: {
    task: string;
    connectors: string[];
    model?: string;
  }): Promise<AgentRun> {
    const run: AgentRun = {
      id: randomUUID().slice(0, 8),
      task: options.task,
      connectors: options.connectors,
      model: options.model || config.defaultModel,
      status: "pending",
      containerId: null,
      sessionFile: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
    };

    const connectorsData = await this.loadConnectorsData();
    const selectedConnectors = connectorsData.filter(c =>
      options.connectors.includes(c.name)
    );

    const secretFilenames = selectedConnectors.map(c => c.secretFile);
    const envVarsMap = await this.sops.decryptMultiple(secretFilenames);

    envVarsMap.set("OPENCODE_API_KEY", config.opencodeGoApiKey);
    envVarsMap.set("OPENCODE_API_URL", config.opencodeGoUrl);

    for (const conn of selectedConnectors) {
      if (conn.url) envVarsMap.set(`${conn.type.toUpperCase()}_URL`, conn.url);
    }

    run.status = "running";
    const container = await this.docker.createAndStartContainer({
      task: options.task,
      envVars: Object.fromEntries(envVarsMap),
      image: config.agentImage,
      sessionVolume: "agent-land-sessions",
      agentRunId: run.id,
      model: run.model,
    });
    run.containerId = container.id;

    const logsDir = path.join(config.dataDir, "logs");
    await mkdir(logsDir, { recursive: true });
    const logPath = path.join(logsDir, `${run.id}.jsonl`);
    const logStream = createWriteStream(logPath, { flags: "a" });

    await this.saveRun(run);

    const logPromise = this.streamLogs(run, logStream);
    const exitPromise = this.docker
      .waitForExit(container.id)
      .then(async (exitCode) => {
        await logPromise;
        logStream.end();

        run.exitCode = exitCode;
        run.status = exitCode === 0 ? "completed" : "failed";
        run.finishedAt = new Date().toISOString();
        await this.saveRun(run);

        await this.docker.removeContainer(container.id).catch(() => {});
      })
      .catch(async (err) => {
        console.error(`Agent ${run.id} lifecycle error:`, err);
        logStream.end();
        run.exitCode = -1;
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        await this.saveRun(run);
      });

    return run;
  }

  private async streamLogs(run: AgentRun, writeStream: ReturnType<typeof createWriteStream>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.streamLogs(run.containerId!).then((demuxed) => {
        const rl = readline.createInterface({ input: demuxed });

        rl.on("line", (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          try {
            const event = JSON.parse(trimmed);

            if (event.type === "session" && event.id) {
              run.sessionFile = `${event.id}.jsonl`;
              this.saveRun(run).catch(() => {});
            }

            const logEntry: LogEntry = {
              timestamp: new Date().toISOString(),
              type: event.type,
              data: event,
            };

            writeStream.write(JSON.stringify(logEntry) + "\n");
          } catch {}
        });

        rl.on("close", resolve);
        rl.on("error", reject);
      }).catch(reject);
    });
  }

  async getRun(runId: string): Promise<AgentRunWithLogs | null> {
    const run = await this.loadRun(runId);
    if (!run) return null;

    const logsDir = path.join(config.dataDir, "logs");
    const logPath = path.join(logsDir, `${runId}.jsonl`);
    let logs: LogEntry[] = [];

    try {
      const content = await readFile(logPath, "utf-8");
      logs = content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line));
    } catch {}

    return { ...run, logs };
  }

  async listRuns(): Promise<AgentRun[]> {
    const runsDir = path.join(config.dataDir, "runs");
    try {
      const files = await readdir(runsDir);
      const runs: AgentRun[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const content = await readFile(path.join(runsDir, file), "utf-8");
        runs.push(JSON.parse(content));
      }
      return runs.sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
    } catch {
      return [];
    }
  }

  private async saveRun(run: AgentRun): Promise<void> {
    const runsDir = path.join(config.dataDir, "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      path.join(runsDir, `${run.id}.json`),
      JSON.stringify(run, null, 2)
    );
  }

  private async loadRun(runId: string): Promise<AgentRun | null> {
    const runPath = path.join(config.dataDir, "runs", `${runId}.json`);
    try {
      await stat(runPath);
      const content = await readFile(runPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async loadConnectorsData(): Promise<Connector[]> {
    const connPath = path.join(config.dataDir, "connectors.json");
    try {
      await stat(connPath);
      const content = await readFile(connPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return [];
    }
  }
}
