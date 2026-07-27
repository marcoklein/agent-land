# Agent Land — Implementation Plan

## Project Structure

```
agent-land/
├── package.json
├── tsconfig.json
├── Dockerfile                  # Orchestrator image (Dokku auto-detect)
├── docker-compose.yml          # Local dev with socket mount
├── .dockerignore
├── .gitignore
├── .env.example
├── design.md
├── plan.md                     # This file
├── src/
│   ├── server.ts               # Express entry point
│   ├── config.ts               # Env parsing + defaults
│   ├── types.ts                # Shared TypeScript types
│   ├── routes/
│   │   ├── index.ts            # Home/dashboard
│   │   ├── secrets.ts          # Secret CRUD + HTMX views
│   │   ├── agents.ts           # Agent launch, list, logs (SSE)
│   │   └── connectors.ts       # Connector CRUD + HTMX views
│   ├── services/
│   │   ├── sops.ts             # SOPS encrypt/decrypt via child_process
│   │   ├── docker.ts           # Dockerode wrapper
│   │   └── agent-runner.ts     # Agent lifecycle orchestrator
│   └── views/
│       ├── layout.ejs          # Base HTML shell
│       ├── home.ejs            # Dashboard
│       ├── partials/
│       │   ├── nav.ejs         # Navigation tabs
│       │   └── flash.ejs       # Flash messages
│       ├── secrets/
│       │   ├── list.ejs        # Table of secrets
│       │   ├── new.ejs         # Create form
│       │   ├── show.ejs        # Secret detail (decrypted, never shown)
│       │   └── edit.ejs        # Edit form
│       ├── agents/
│       │   ├── list.ejs        # Past + running agents
│       │   ├── new.ejs         # Launch form
│       │   ├── show.ejs        # Single agent: logs + session data
│       │   └── _log-stream.ejs # SSE log fragment
│       └── connectors/
│           ├── list.ejs        # Connector table
│           ├── new.ejs         # Create form
│           └── edit.ejs        # Edit form
├── secrets/                    # SOPS-encrypted YAML files (gitignored)
│   └── .gitkeep
├── data/                       # Runtime data volume (gitignored)
│   └── .gitkeep
└── agent-image/               # Pi agent Docker image (separate build)
    ├── Dockerfile
    └── entrypoint.sh
```

## Step-by-Step Implementation

### Step 1: Project Scaffold

**package.json** — Key dependencies:

```json
{
  "name": "agent-land",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "express": "^5.0.0",
    "ejs": "^3.1.10",
    "dockerode": "^4.0.2",
    "express-session": "^1.18.0",
    "cookie-parser": "^1.4.6",
    "connect-flash": "^0.1.1",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/ejs": "^3.1.5",
    "@types/dockerode": "^3.3.31",
    "@types/express-session": "^1.18.0",
    "@types/cookie-parser": "^1.4.7",
    "@types/connect-flash": "^0.0.39",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

**tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

### Step 2: Server Entry Point

**src/server.ts:**

```typescript
import express from "express";
import session from "express-session";
import flash from "connect-flash";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { getConfig } from "./config.js";
import { indexRouter } from "./routes/index.js";
import { secretsRouter } from "./routes/secrets.js";
import { agentsRouter } from "./routes/agents.js";
import { connectorsRouter } from "./routes/connectors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = getConfig();

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
  })
);
app.use(flash());

// Make config and flash available in all templates
app.use((req, res, next) => {
  res.locals.flashMessages = req.flash();
  res.locals.appName = "Agent Land";
  next();
});

app.use("/", indexRouter);
app.use("/secrets", secretsRouter);
app.use("/agents", agentsRouter);
app.use("/connectors", connectorsRouter);

app.listen(config.port, () => {
  console.log(`Agent Land orchestrator running on http://localhost:${config.port}`);
});
```

**src/config.ts:**

```typescript
export interface Config {
  port: number;
  sessionSecret: string;
  secretsDir: string;
  dataDir: string;
  agentImage: string;
  sessionVolume: string;
  dataVolume: string;
  ageKeyFile: string;
  opencodeGoUrl: string;
  opencodeGoApiKey: string;
  defaultModel: string;
}

export function getConfig(): Config {
  return {
    port: parseInt(process.env.PORT || "3000"),
    sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",
    secretsDir: process.env.SECRETS_DIR || path.resolve("secrets"),
    dataDir: process.env.DATA_DIR || path.resolve("data"),
    agentImage: process.env.AGENT_IMAGE || "agent-land-pi:latest",
    sessionVolume: process.env.SESSION_VOLUME || "agent-land-sessions",
    dataVolume: process.env.DATA_VOLUME || "agent-land-data",
    ageKeyFile: process.env.AGE_KEY_FILE || path.resolve(".age-key"),
    opencodeGoUrl: process.env.OPENCODE_GO_URL || "https://api.opencode.ai",
    opencodeGoApiKey: process.env.OPENCODE_GO_API_KEY || "",
    defaultModel: process.env.DEFAULT_MODEL || "opencode-go/default",
  };
}
```

### Step 3: Types

**src/types.ts:**

```typescript
export interface Connector {
  name: string;
  type: "jira" | "github" | "gmail" | "custom";
  url: string;                // displayed in UI without decrypting secret
  secretFile: string;         // filename in secrets/ dir
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  task: string;               // original user input (before prompt construction)
  connectors: string[];       // connector names used
  model: string;
  status: "pending" | "running" | "completed" | "failed";
  containerId: string | null;
  sessionFile: string | null; // path to pi session JSONL on volume
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
}

export interface AgentRunWithLogs extends AgentRun {
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: string;
  type: string;               // agent_start, turn_start, message_end, etc.
  data: Record<string, unknown>;
}

export interface SecretInfo {
  name: string;               // filename without .yaml
  filename: string;           // full filename
  size: number;               // bytes
  modifiedAt: string;
}

export interface DecryptedSecret {
  name: string;
  content: string;            // decrypted YAML as string
}
```

### Step 4: SOPS Service

**src/services/sops.ts:**

```typescript
import { execFile } from "child_process";
import { readdir, stat, unlink, readFile } from "fs/promises";
import path from "path";
import { SecretInfo, DecryptedSecret } from "../types.js";

export class SopsService {
  constructor(
    private secretsDir: string,
    private ageKeyFile: string
  ) {}

  async listSecrets(): Promise<SecretInfo[]> {
    const files = await readdir(this.secretsDir);
    const secrets: SecretInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      if (file.startsWith(".")) continue;
      const filePath = path.join(this.secretsDir, file);
      const stats = await stat(filePath);
      secrets.push({
        name: file.replace(/\.(ya?ml)$/, ""),
        filename: file,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }

    return secrets;
  }

  async encrypt(name: string, plaintext: string): Promise<string> {
    const filePath = path.join(this.secretsDir, `${name}.yaml`);
    const agePublicKey = await this.getPublicKey();

    return new Promise((resolve, reject) => {
      const child = execFile(
        "sops",
        [
          "--encrypt",
          "--age", agePublicKey,
          "--input-type", "yaml",
          "--output-type", "yaml",
          "/dev/stdin",
        ],
        { env: { ...process.env, SOPS_AGE_KEY_FILE: this.ageKeyFile } },
        (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout);
        }
      );

      if (child.stdin) {
        child.stdin.write(plaintext);
        child.stdin.end();
      }
    });
  }

  async saveEncrypted(name: string, plaintext: string): Promise<void> {
    const encrypted = await this.encrypt(name, plaintext);
    const filePath = path.join(this.secretsDir, `${name}.yaml`);
    await Bun.write(filePath, encrypted); // Or use writeFile
  }

  async decrypt(filename: string): Promise<DecryptedSecret> {
    const filePath = path.join(this.secretsDir, filename);

    return new Promise((resolve, reject) => {
      execFile(
        "sops",
        ["--decrypt", "--input-type", "yaml", "--output-type", "yaml", filePath],
        { env: { ...process.env, SOPS_AGE_KEY_FILE: this.ageKeyFile } },
        (err, stdout) => {
          if (err) return reject(new Error(`SOPS decrypt failed: ${err.message}`));
          resolve({
            name: filename.replace(/\.(ya?ml)$/, ""),
            content: stdout,
          });
        }
      );
    });
  }

  async decryptMultiple(filenames: string[]): Promise<Map<string, string>> {
    const envMap = new Map<string, string>();
    for (const filename of filenames) {
      const { content } = await this.decrypt(filename);
      // Parse YAML content into flat env vars
      // e.g., "GITHUB_TOKEN: ghp_xxx" -> envMap.set("GITHUB_TOKEN", "ghp_xxx")
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;
        const key = trimmed.substring(0, colonIdx).trim();
        const value = trimmed.substring(colonIdx + 1).trim();
        if (key && value) envMap.set(key, value);
      }
    }
    return envMap;
  }

  async deleteSecret(name: string): Promise<void> {
    const filePath = path.join(this.secretsDir, `${name}.yaml`);
    await unlink(filePath);
  }

  async secretExists(name: string): Promise<boolean> {
    const filePath = path.join(this.secretsDir, `${name}.yaml`);
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async getPublicKey(): Promise<string> {
    // Parse the age public key from .sops.yaml in secrets dir
    const sopsYaml = path.join(this.secretsDir, ".sops.yaml");
    try {
      const content = await readFile(sopsYaml, "utf-8");
      const match = content.match(/age:\s*>\s*(age1\S+)/);
      if (match) return match[1];
    } catch {
      // fallback: read directly from age-keygen output
    }
    throw new Error("Could not determine age public key. Ensure secrets/.sops.yaml exists.");
  }
}
```

### Step 5: Docker Service

**src/services/docker.ts:**

```typescript
import Docker from "dockerode";
import { Readable } from "stream";

export class DockerService {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
  }

  async runAgent(options: {
    task: string;
    envVars: Record<string, string>;
    image: string;
    sessionVolume: string;
    dataVolume: string;
    agentRunId: string;
  }): Promise<{ containerId: string; logStream: Readable }> {
    const env = Object.entries(options.envVars).map(
      ([k, v]) => `${k}=${v}`
    );

    const container = await this.docker.createContainer({
      Image: options.image,
      Cmd: [
        "--mode", "json",
        "--provider", "opencode-go",
        "--model", process.env.DEFAULT_MODEL || "opencode-go/default",
        "--session-dir", "/sessions",
        "--name", options.agentRunId,
        "--approve",
        options.task,
      ],
      Env: [
        ...env,
        `PI_OFFLINE=1`,
        `PI_SKIP_VERSION_CHECK=1`,
        `PI_CODING_AGENT_SESSION_DIR=/sessions`,
        `PI_CODING_AGENT_DIR=/tmp/pi-config`,
      ],
      HostConfig: {
        AutoRemove: true,
        Binds: [
          `${options.sessionVolume}:/sessions`,
          `${options.dataVolume}:/data`,
        ],
        NetworkMode: "bridge",
      },
      WorkingDir: "/workspace",
    });

    await container.start();

    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
    });

    return {
      containerId: container.id,
      logStream,
    };
  }

  async listContainers(): Promise<Docker.ContainerInfo[]> {
    return this.docker.listContainers({ all: true });
  }

  async getContainer(id: string): Promise<Docker.Container> {
    return this.docker.getContainer(id);
  }

  async stopContainer(id: string): Promise<void> {
    const container = this.docker.getContainer(id);
    await container.stop().catch(() => {}); // already stopped is fine
  }
}
```

### Step 6: Agent Runner Service

**src/services/agent-runner.ts:**

```typescript
import { randomUUID } from "crypto";
import { readFile, writeFile, stat, mkdir } from "fs/promises";
import path from "path";
import { AgentRun, AgentRunWithLogs, LogEntry } from "../types.js";
import { SopsService } from "./sops.js";
import { DockerService } from "./docker.js";
import { getConfig } from "../config.js";
import { Readable } from "stream";
import readline from "readline";

const config = getConfig();

export class AgentRunner {
  private activeRuns = new Map<string, {
    run: AgentRun;
    abort: AbortController;
  }>();

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
    const envVars = await this.sops.decryptMultiple(secretFilenames);

    // Add OpenCode Go credentials
    envVars.set("OPENCODE_GO_API_KEY", config.opencodeGoApiKey);
    envVars.set("OPENCODE_GO_URL", config.opencodeGoUrl);

    // Add connector URLs as env vars
    for (const conn of selectedConnectors) {
      if (conn.url) envVars.set(`${conn.type.toUpperCase()}_URL`, conn.url);
    }

    run.status = "running";
    const { containerId, logStream } = await this.docker.runAgent({
      task: options.task,
      envVars: Object.fromEntries(envVars),
      image: config.agentImage,
      sessionVolume: config.sessionVolume,
      dataVolume: config.dataVolume,
      agentRunId: run.id,
    });
    run.containerId = containerId;

    // Store run
    const abort = new AbortController();
    this.activeRuns.set(run.id, { run, abort });
    await this.saveRun(run);

    // Background: stream logs and track completion
    this.handleContainerLifecycle(run, logStream, abort.signal);

    return run;
  }

  private async handleContainerLifecycle(
    run: AgentRun,
    logStream: Readable,
    signal: AbortSignal
  ): Promise<void> {
    const rl = readline.createInterface({ input: logStream });

    // Write log entries to a file
    const logsDir = path.join(config.dataDir, "logs");
    await mkdir(logsDir, { recursive: true });
    const logFile = Bun.file(path.join(logsDir, `${run.id}.jsonl`));

    for await (const line of rl) {
      if (signal.aborted) break;

      // Docker logs prefix: 8 bytes header + content
      // Strip Docker's 8-byte header from each chunk
      const cleanLine = line.replace(/^.{8}/, "");

      try {
        const event = JSON.parse(cleanLine);
        if (event.type === "session") {
          run.sessionFile = `${event.id}.jsonl`;
        }

        // Append to log file
        const logEntry: LogEntry = {
          timestamp: new Date().toISOString(),
          type: event.type,
          data: event,
        };
        const writer = logFile.writer();
        writer.write(JSON.stringify(logEntry) + "\n");
        await writer.end();
      } catch {
        // Non-JSON line (stderr, startup output, etc.)
      }
    }

    // Get container exit code
    try {
      const container = await this.docker.getContainer(run.containerId!);
      const inspect = await container.inspect();
      run.exitCode = inspect.State.ExitCode;
      run.status = run.exitCode === 0 ? "completed" : "failed";
    } catch {
      run.status = "failed";
    }

    run.finishedAt = new Date().toISOString();
    this.activeRuns.delete(run.id);
    await this.saveRun(run);
  }

  getLogStream(runId: string): Readable | null {
    // For SSE: read the log file and create a readable stream
    const logsDir = path.join(config.dataDir, "logs");
    const logPath = path.join(logsDir, `${runId}.jsonl`);
    return Bun.file(logPath).stream();
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
    } catch {
      // No logs yet
    }

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

  private async loadConnectorsData(): Promise<import("../types.js").Connector[]> {
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
```

### Step 7: View Layout

**src/views/layout.ejs:**

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Land</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0-beta6/dist/htmx.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0-beta6/dist/ext/hx-sse.min.js"></script>
  <style>
    .container { max-width: 900px; }
    nav { margin-bottom: var(--pico-spacing); }
    .log-container {
      background: var(--pico-color-grey-900);
      color: var(--pico-color-grey-100);
      padding: var(--pico-spacing);
      border-radius: var(--pico-border-radius);
      font-family: var(--pico-font-family-monospace);
      font-size: 0.85rem;
      max-height: 500px;
      overflow-y: auto;
      white-space: pre-wrap;
      line-height: 1.6;
    }
    .log-agent-start  { color: #60a5fa; }
    .log-turn         { color: #a78bfa; margin-top: 4px; }
    .log-tool         { color: #94a3b8; }
    .log-tool-ok      { color: #4ade80; }
    .log-tool-err     { color: #f87171; }
    .log-assistant    { color: #e2e8f0; margin: 8px 0; padding: 4px 0; border-left: 2px solid #475569; padding-left: 12px; }
    .log-error        { color: #f87171; }
    .run-completed    { color: #4ade80; text-align: center; padding: 8px; border-top: 1px solid #334155; margin-top: 8px; }
  </style>
</head>
<body>
  <main class="container">
    <%- include("partials/nav") %>
    <%- include("partials/flash") %>
    <%- body %>
  </main>
</body>
</html>
```

**src/views/partials/nav.ejs:**

```html
<nav>
  <ul>
    <li><strong>Agent Land</strong></li>
  </ul>
  <ul>
    <li><a href="/" role="button" class="<%= currentPage === 'home' ? '' : 'outline' %>">Dashboard</a></li>
    <li><a href="/secrets" role="button" class="<%= currentPage === 'secrets' ? '' : 'outline' %>">Secrets</a></li>
    <li><a href="/connectors" role="button" class="<%= currentPage === 'connectors' ? '' : 'outline' %>">Connectors</a></li>
    <li><a href="/agents" role="button" class="<%= currentPage === 'agents' ? '' : 'outline' %>">Agents</a></li>
    <li><a href="/agents/new" role="button" class="<%= currentPage === 'new-agent' ? '' : 'outline' %>">Launch</a></li>
  </ul>
</nav>
```

**src/views/partials/flash.ejs:**

```html
<% if (flashMessages.success && flashMessages.success.length) { %>
  <% flashMessages.success.forEach(msg => { %>
    <ins><%= msg %></ins>
  <% }) %>
<% } %>
<% if (flashMessages.error && flashMessages.error.length) { %>
  <% flashMessages.error.forEach(msg => { %>
    <del><%= msg %></del>
  <% }) %>
<% } %>
```

### Step 8: Prompt Construction Service

**src/services/prompt.ts:**

```typescript
import { Connector } from "../types.js";

/**
 * Constructs the prompt passed to pi. Prepends connector info automatically;
 * the user's free-form task is appended as-is.
 */
export function buildPrompt(task: string, connectors: Connector[]): string {
  const parts: string[] = [];

  if (connectors.length > 0) {
    parts.push("Connectors available this session:");
    for (const conn of connectors) {
      const envVars = getConnectorEnvVars(conn);
      const envList = envVars.map(v => `$${v}`).join(", ");
      parts.push(`- ${conn.name} (${conn.type}): Credentials in ${envList}`);
    }
    parts.push("");
  }

  parts.push("---");
  parts.push(task);

  return parts.join("\n");
}

function getConnectorEnvVars(conn: Connector): string[] {
  switch (conn.type) {
    case "github": return ["GITHUB_TOKEN", "GITHUB_API_URL"];
    case "jira":   return ["JIRA_URL", "JIRA_API_TOKEN"];
    case "gmail":  return ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"];
    default:       return Object.keys(conn.config).map(k => k.toUpperCase());
  }
}
```

### Step 9: Log Rendering Service

**src/services/log-renderer.ts:**

Parses pi's `--mode json` events into styled HTML fragments for the SSE stream.

```typescript
/**
 * Converts a pi JSONL event into an HTML fragment for the log viewer.
 * Returns null for events that should not be displayed.
 */
export function renderLogEntry(event: Record<string, any>): string | null {
  switch (event.type) {
    case "agent_start":
      return `<div class="log-agent-start">Agent started</div>`;

    case "turn_start":
      return `<div class="log-turn">--- Turn ---</div>`;

    case "message_end": {
      const msg = event.message;
      if (msg.role === "assistant") {
        const text = extractText(msg.content);
        if (!text) return null;
        return `<div class="log-assistant">${escapeHtml(text)}</div>`;
      }
      return null;
    }

    case "tool_execution_start":
      return `<div class="log-tool"><span class="log-tool-name">${escapeHtml(event.toolName)}</span> ${truncateArgs(event.args)}</div>`;

    case "tool_execution_end":
      if (event.isError) {
        return `<div class="log-tool log-tool-err">${escapeHtml(event.toolName)} failed: ${escapeHtml(truncate(String(event.result)))}</div>`;
      }
      return `<div class="log-tool log-tool-ok">${escapeHtml(event.toolName)} completed</div>`;

    case "agent_end":
      return null; // handled by the named agent-done event below

    default:
      return null;
  }
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

function truncateArgs(args: any): string {
  const str = typeof args === "string" ? args : JSON.stringify(args);
  return escapeHtml(str.length > 120 ? str.substring(0, 117) + "..." : str);
}

function truncate(s: string): string {
  return s.length > 200 ? s.substring(0, 197) + "..." : s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

### Step 10: Agent Routes & Views

**src/routes/agents.ts:**

```typescript
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
const sops = new SopsService(config.secretsDir, config.ageKeyFile);
const docker = new DockerService();
const runner = new AgentRunner(sops, docker);

export const agentsRouter = Router();

// List past runs
agentsRouter.get("/", async (req, res) => {
  const runs = await runner.listRuns();
  res.render("agents/list", { currentPage: "agents", runs });
});

// Launch form
agentsRouter.get("/new", async (req, res) => {
  const connectors = await loadConnectors();
  res.render("agents/new", { currentPage: "new-agent", connectors });
});

// Launch agent — constructs prompt, starts container, redirects
agentsRouter.post("/run", async (req, res) => {
  const { task, connectors, model } = req.body;
  const connectorList: string[] = Array.isArray(connectors)
    ? connectors
    : [connectors].filter(Boolean);

  try {
    const allConnectors = await loadConnectors();
    const selected = allConnectors.filter(c => connectorList.includes(c.name));
    const prompt = buildPrompt(task, selected);
    const run = await runner.launch({ task: prompt, connectors: connectorList, model });
    res.header("HX-Redirect", `/agents/${run.id}`);
  } catch (err: any) {
    req.flash("error", `Launch failed: ${err.message}`);
    res.header("HX-Redirect", "/agents/new");
  }
});

// View agent run with live SSE logs
agentsRouter.get("/:id", async (req, res) => {
  const run = await runner.getRun(req.params.id);
  if (!run) {
    req.flash("error", "Agent run not found.");
    return res.redirect("/agents");
  }
  res.render("agents/show", { currentPage: "agents", run });
});

// SSE endpoint — streams styled HTML fragments
agentsRouter.get("/:id/logs", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const run = await runner.getRun(req.params.id);
  if (!run) {
    res.write(`data: <div class="log-error">Agent run not found</div>\n\n`);
    res.write(`event: agent-done\ndata: {}\n\n`);
    return res.end();
  }

  // Replay existing logs
  for (const log of run.logs) {
    const html = renderLogEntry(log.data);
    if (html) {
      res.write(`data: ${html}\n\n`);
    }
  }

  // If still running, stream new events
  if (run.status === "running") {
    const stream = runner.getLogStream(req.params.id);
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const logEntry = JSON.parse(value);
          const html = renderLogEntry(logEntry.data);
          if (html) {
            res.write(`data: ${html}\n\n`);
          }
        }
      } catch {}
    }
  }

  // Signal completion
  const finalRun = await runner.getRun(req.params.id);
  res.write(`event: agent-done\ndata: {"status":"${finalRun?.status || "completed"}","exitCode":${finalRun?.exitCode ?? -1}}\n\n`);
  res.end();
});

// HTMX endpoint: returns updated status badge
agentsRouter.get("/:id/status", async (req, res) => {
  const run = await runner.getRun(req.params.id);
  if (!run) return res.send(`<mark>not found</mark>`);
  const cls = run.status === "running" ? "" : run.status === "completed" ? "pico-color-jade-100" : "pico-color-red-100";
  res.send(`<mark id="status-badge" class="${cls}">${run.status}</mark>`);
});

async function loadConnectors(): Promise<Connector[]> {
  try {
    const content = await readFile(`${config.dataDir}/connectors.json`, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}
```

**src/views/agents/new.ejs:**

```html
<article>
  <header><h2>Launch Agent</h2></header>
  <p><small>The agent runs <code>pi --mode json</code> in a Docker container with the selected connectors' credentials. Connector info is prepended automatically — just write your task.</small></p>

  <form method="POST" action="/agents/run">
    <label for="task">Task / Prompt</label>
    <textarea id="task" name="task" rows="4"
              placeholder="Clone github.com/me/my-project, read Jira issue ABC-123, and fix the login rate limiting" required></textarea>

    <fieldset>
      <legend>Connectors</legend>
      <% connectors.forEach(c => { %>
      <label>
        <input type="checkbox" name="connectors" value="<%= c.name %>">
        <strong><%= c.name %></strong> <small>(<%= c.type %>)</small>
      </label>
      <% }) %>
      <% if (connectors.length === 0) { %>
      <p><small><em>No connectors defined. <a href="/connectors/new">Create one</a> first.</em></small></p>
      <% } %>
    </fieldset>

    <label for="model">Model (optional)</label>
    <input type="text" id="model" name="model" placeholder="opencode-go/default">

    <button type="submit">Launch Agent</button>
    <a href="/agents" role="button" class="outline">Cancel</a>
  </form>
</article>
```

**src/views/agents/show.ejs — Live log with HTMX4 SSE:**

```html
<article>
  <header style="display:flex; justify-content:space-between; align-items:center">
    <hgroup>
      <h2>Agent <code><%= run.id %></code></h2>
      <p>
        <strong>Task:</strong> <small><%= run.task.substring(0, 100) %></small><br>
        <strong>Connectors:</strong> <%= run.connectors.join(", ") || "none" %><br>
        <strong>Started:</strong> <%= new Date(run.startedAt).toLocaleString() %>
      </p>
    </hgroup>
    <span id="status-badge">
      <mark class="<%= run.status === 'running' ? '' : run.status === 'completed' ? 'pico-color-jade-100' : 'pico-color-red-100' %>">
        <%= run.status %>
      </mark>
    </span>
  </header>

  <h4>Logs</h4>
  <div id="log-container"
       class="log-container"
       hx-sse:connect="/agents/<%= run.id %>/logs"
       hx-swap="beforeend"
       hx-sse:close="agent-done"
       hx-on:agent-done="htmx.ajax('GET', '/agents/<%= run.id %>/status', {target:'#status-badge'}); this.insertAdjacentHTML('beforeend', '<div class=\\'run-completed\\'>Agent finished</div>')">
    <% if (run.status !== 'running') { %>
    <div class="run-completed">Agent <%= run.status %> (exit code: <%= run.exitCode %>)</div>
    <% } %>
  </div>

  <footer style="margin-top: 16px;">
    <a href="/agents" role="button" class="outline">Back to Agents</a>
    <% if (run.sessionFile) { %>
    <small style="margin-left:12px">Session: <code><%= run.sessionFile %></code></small>
    <% } %>
  </footer>
</article>
```

### Step 10: Dockerfile (Orchestrator)

**Dockerfile:**

```dockerfile
FROM node:22-alpine

RUN apk add --no-cache sops age

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY src/views/ ./src/views/

ENV NODE_ENV=production
ENV PORT=3000
ENV SECRETS_DIR=/app/secrets
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

### Step 12: Pi Agent Docker Image

**agent-image/Dockerfile:**

```dockerfile
FROM node:22-slim

# Pre-baked tools: universally needed for coding agent tasks
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI via official APT repo (reads GITHUB_TOKEN automatically)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @earendil-works/pi-coding-agent@0.82.1

WORKDIR /workspace

# Connector skills: teach pi how to use Jira, GitHub, Gmail APIs
COPY skills/ ~/.pi/agent/skills/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

**agent-image/entrypoint.sh:**

```bash
#!/bin/sh
set -e
mkdir -p /sessions /workspace
exec pi --mode json --session-dir /sessions --approve "$@"
```

**agent-image/skills/ directory:**

```
skills/
├── jira/SKILL.md
├── github/SKILL.md
└── gmail/SKILL.md
```

### Step 13: Docker Compose (Local Dev)

**docker-compose.yml:**

```yaml
version: "3.8"

services:
  orchestrator:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./secrets:/app/secrets
      - ./data:/app/data
      - agent_land_sessions:/sessions
    env_file:
      - .env
    environment:
      - NODE_ENV=development
      - SESSION_VOLUME=agent_land_sessions
      - DATA_VOLUME=agent_land_data

volumes:
  agent_land_sessions:
  agent_land_data:
```

### Step 14: Dokku Deployment

**Dokku app script** for `personal-infra/apps/agent-land.sh`:

```bash
APP="agent-land"

step "Setting up $APP"

dokku_app_create "$APP"
dokku_domain_set "$APP" "agents.impromat.app"

# Docker socket access for spawning agent containers
dokku_docker_option_deploy "$APP" \
  "--restart=on-failure:10" \
  "-v /var/run/docker.sock:/var/run/docker.sock"

# Persistent volumes for secrets, data, and sessions
dokku_storage_mount "$APP" \
  "${AGENT_LAND_DATA_HOST}:/app/data" \
  "${AGENT_LAND_SECRETS_HOST}:/app/secrets" \
  "${AGENT_LAND_SESSIONS_HOST}:/app/sessions"

# Environment variables (from .env via CI/CD)
dokku_config_set "$APP" \
  SESSION_SECRET="$AGENT_LAND_SESSION_SECRET" \
  OPENCODE_GO_API_KEY="$OPENCODE_GO_API_KEY" \
  OPENCODE_GO_URL="$OPENCODE_GO_URL" \
  AGE_KEY_FILE="/app/secrets/.age-key" \
  DEFAULT_MODEL="opencode-go/default" \
  SESSION_VOLUME="agent-land-sessions" \
  DATA_VOLUME="agent-land-data"

# SSL
dokku_letsencrypt_enable "$APP"
```

**Required additions to `personal-infra/.env`:**

```bash
# Agent Land
AGENT_LAND_SESSION_SECRET=your-random-secret
AGENT_LAND_STORAGE_HOST=/var/lib/dokku/data/storage/agent-land
AGENT_LAND_DATA_HOST=/var/lib/dokku/data/storage/agent-land-data
AGENT_LAND_SECRETS_HOST=/var/lib/dokku/data/storage/agent-land-secrets
AGENT_LAND_SESSIONS_HOST=/var/lib/dokku/data/storage/agent-land-sessions
```

## What's Not in v1

- **Authentication** — No login. The orchestrator runs on a trusted server. Add HTTP basic auth via Dokku's `dokku_http_auth_enable` when needed (~1 line).
- **Database** — Agent runs stored as JSON files in `data/runs/`. Connectors stored as `data/connectors.json`. No SQLite dependency.
- **Cron/scheduled agents** — Agents are launched manually via the HTMX UI. Schedules can be added later via a cron service.
- **Agent interaction** — Fire-and-forget only. No WebSocket terminal for interactive pi sessions. Pi sessions persist as JSONL files for later inspection.
- **Multi-user** — Single user. Secrets and agents are shared. No per-user scoping.
