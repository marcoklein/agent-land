import express from "express";
import session from "express-session";
import flash from "connect-flash";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, rm, writeFile, readFile, stat } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { PassThrough } from "stream";
import { SopsService } from "../../infra/sops.js";
import { JsonConnectorRepository, JsonSessionRepository, JsonSessionEventLog } from "../../infra/repositories.js";
import { ConnectorService } from "../../core/connector-service.js";
import { SessionService } from "../../core/session-service.js";
import { GitCloneProvisioner } from "../../infra/git-clone-provisioner.js";
import type { DockerPort } from "../../core/ports.js";
import type { AgentHarness, AgentHandle, EventStream } from "../../core/harness.js";
import type { SessionEvent } from "../../core/events.js";
import type { AgentSession } from "../../core/types.js";
import { connectorsRouter } from "../../routes/connectors.js";
import { agentsRouter } from "../../routes/agents.js";
import { sessionsApiRouter } from "../../presentation/http/api-sessions.js";
import { connectorsApiRouter } from "../../presentation/http/api-connectors.js";
import { modelsApiRouter } from "../../presentation/http/api-models.js";
import { getConfig } from "../../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testConfig = getConfig();
const execFileAsync = promisify(execFile);

function baseApp() {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "..", "..", "views"));

  app.use(express.static(path.join(__dirname, "..", "..", "..", "public")));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(flash());

  app.use((req, res, next) => {
    res.locals.flashMessages = req.flash();
    res.locals.appName = "Agent Land";
    res.locals.formatDuration = (sec: number) => {
      const s = Math.round(sec);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      const rs = s % 60;
      return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
    };
    next();
  });

  return app;
}

export function createTestApp() {
  const app = baseApp();

  const sops = new SopsService(testConfig.secretsDir, testConfig.ageKeyFile);
  const connectorRepository = new JsonConnectorRepository(testConfig.dataDir);
  const connectorService = new ConnectorService(connectorRepository, sops);
  app.use("/connectors", connectorsRouter(connectorService));

  return app;
}

export class MockDockerPort implements DockerPort {
  created: {
    id: string;
    envVars: Record<string, string>;
    image: string;
    workspaceVolume: string;
  }[] = [];
  removed: string[] = [];
  removedVolumes: string[] = [];
  execs: { containerId: string; args: string[] }[] = [];
  containers = new Set<string>();
  execCommandImpl?: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

  reset() {
    this.created = [];
    this.removed = [];
    this.removedVolumes = [];
    this.execs = [];
    this.containers = new Set();
    this.execCommandImpl = undefined;
  }

  async createInteractiveContainer(opts: {
    id: string;
    envVars: Record<string, string>;
    image: string;
    sessionVolume: string;
    workspaceVolume: string;
  }) {
    this.created.push({
      id: opts.id,
      envVars: opts.envVars,
      image: opts.image,
      workspaceVolume: opts.workspaceVolume,
    });
    this.containers.add(`agent-land-pi-${opts.id}`);
    return { id: `mock-${opts.id}` } as any;
  }

  async execInteractive(_containerId: string, _args: string[], _tty: boolean) {
    return { stream: new PassThrough(), resize: async () => {} };
  }

  async execCommand(containerId: string, args: string[]) {
    this.execs.push({ containerId, args });
    if (this.execCommandImpl) return this.execCommandImpl(args);
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async removeContainer(id: string) {
    this.removed.push(id);
  }

  async removeVolume(name: string) {
    this.removedVolumes.push(name);
  }

  async ensureAgentImage(_image: string) {}

  async containerExists(id: string): Promise<boolean> {
    return this.containers.has(id);
  }
}

export class FakeHandle implements AgentHandle {
  private handlers = new Set<(e: SessionEvent) => void>();
  prompts: string[] = [];
  promptBehaviors: (("steer" | "followUp") | undefined)[] = [];
  responded: { requestId: string; value: Record<string, unknown> }[] = [];
  aborted = false;
  stopped = false;

  events(): EventStream {
    return {
      subscribe: (handler) => {
        this.handlers.add(handler);
        return () => {
          this.handlers.delete(handler);
        };
      },
    };
  }

  emit(event: SessionEvent) {
    for (const h of this.handlers) h(event);
  }

  async prompt(message: string, behavior?: "steer" | "followUp") {
    this.prompts.push(message);
    this.promptBehaviors.push(behavior);
  }

  async respond(requestId: string, value: { value?: string; confirmed?: boolean; cancelled?: boolean }) {
    this.responded.push({ requestId, value });
  }

  async abort() {
    this.aborted = true;
  }

  async stop() {
    this.stopped = true;
    this.emit({ type: "status", status: "stopped" });
  }
}

export class FakeHarness implements AgentHarness {
  handles: FakeHandle[] = [];

  reset() {
    this.handles = [];
  }

  async start(_session: AgentSession): Promise<AgentHandle> {
    const handle = new FakeHandle();
    this.handles.push(handle);
    return handle;
  }
}

export interface AgentTestApp {
  app: express.Express;
  mockDocker: MockDockerPort;
  fakeHarness: FakeHarness;
  sessionService: SessionService;
}

export function createAgentTestApp(): AgentTestApp {
  const app = baseApp();

  const sops = new SopsService(testConfig.secretsDir, testConfig.ageKeyFile);
  const sessionRepository = new JsonSessionRepository(testConfig.dataDir);
  const connectorRepository = new JsonConnectorRepository(testConfig.dataDir);
  const eventLog = new JsonSessionEventLog(testConfig.dataDir);
  const connectorService = new ConnectorService(connectorRepository, sops);

  const mockDocker = new MockDockerPort();
  const fakeHarness = new FakeHarness();
  const provisioner = new GitCloneProvisioner(mockDocker, {
    gitUserName: "Test Bot",
    gitUserEmail: "bot@test.local",
  });
  const sessionService = new SessionService(
    {
      docker: mockDocker,
      secrets: sops,
      sessions: sessionRepository,
      connectors: connectorRepository,
      harness: fakeHarness,
      provisioner,
      eventLog,
      config: testConfig,
    },
    20
  );

  app.use("/agents", agentsRouter(sessionService, connectorService));
  app.use("/api/sessions", sessionsApiRouter(sessionService, testConfig));
  app.use("/api/connectors", connectorsApiRouter(connectorService));
  app.use("/api/models", modelsApiRouter());

  return { app, mockDocker, fakeHarness, sessionService };
}

export async function setupDataDir() {
  await ensureTestFixtures();
  await mkdir(testConfig.dataDir, { recursive: true });
  await emptyConnectors();
}

async function ensureTestFixtures(): Promise<void> {
  const sopsYaml = path.join(testConfig.secretsDir, ".sops.yaml");
  try {
    await stat(sopsYaml);
    await stat(testConfig.ageKeyFile);
    return;
  } catch {}

  await mkdir(testConfig.secretsDir, { recursive: true });

  try {
    await execFileAsync("age-keygen", ["-o", testConfig.ageKeyFile]);
    await execFileAsync("sops", ["--version"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Test fixtures are missing and cannot be generated: age-keygen and sops binaries are required (${message})`
    );
  }

  const keyFile = await readFile(testConfig.ageKeyFile, "utf-8");
  const publicKey = keyFile
    .split("\n")
    .find((line) => line.startsWith("# public key: "))
    ?.slice("# public key: ".length)
    .trim();
  if (!publicKey) throw new Error("Could not read age public key from generated key file");

  await writeFile(sopsYaml, `creation_rules:\n  - age: ${publicKey}\n`);
}

export async function cleanupDataDir() {
  await rm(testConfig.dataDir, { recursive: true, force: true });
}

async function emptyConnectors() {
  const connectorPath = path.join(testConfig.dataDir, "connectors.json");
  await writeFile(connectorPath, "[]");
}

export function getDataDir() {
  return testConfig.dataDir;
}
