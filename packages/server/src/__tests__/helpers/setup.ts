import path from "path";
import express from "express";
import { mkdir, rm, writeFile, readFile, stat } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { PassThrough } from "stream";
import { SopsService } from "../../infra/sops.js";
import {
  JsonConnectorRepository,
  JsonSessionRepository,
  JsonSessionEventLog,
  JsonProviderRepository,
} from "../../infra/repositories.js";
import { ConnectorService } from "../../core/connector-service.js";
import { ProviderService } from "../../core/provider-service.js";
import { ModelCatalog } from "../../infra/model-catalog.js";
import { PiConfigProvisioner } from "../../infra/pi-config-provisioner.js";
import { SessionService } from "../../core/session-service.js";
import type { DockerPort } from "../../core/ports.js";
import type { AgentHarness, AgentHandle, EventStream } from "../../core/harness.js";
import type { SessionEvent } from "../../core/events.js";
import type { AgentSession } from "../../core/types.js";
import { sessionsApiRouter } from "../../presentation/http/api-sessions.js";
import { connectorsApiRouter } from "../../presentation/http/api-connectors.js";
import { providersApiRouter } from "../../presentation/http/api-providers.js";
import { modelsApiRouter } from "../../presentation/http/api-models.js";
import { getConfig } from "../../config.js";

const execFileAsync = promisify(execFile);
const testConfig = getConfig();

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
  writtenFiles: { destPath: string; content: string }[] = [];

  reset() {
    this.created = [];
    this.removed = [];
    this.removedVolumes = [];
    this.execs = [];
    this.containers = new Set();
    this.execCommandImpl = undefined;
    this.writtenFiles = [];
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

  async writeFile(_containerId: string, destPath: string, content: string, _mode?: number): Promise<void> {
    this.writtenFiles = this.writtenFiles ?? [];
    this.writtenFiles.push({ destPath, content });
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
  connectorService: ConnectorService;
  providerService: ProviderService;
}

export function createAgentTestApp(): AgentTestApp {
  const app = express();
  app.use(express.json());

  const sops = new SopsService(testConfig.secretsDir, testConfig.ageKeyFile);
  const sessionRepository = new JsonSessionRepository(testConfig.dataDir);
  const connectorRepository = new JsonConnectorRepository(testConfig.dataDir);
  const providerRepository = new JsonProviderRepository(testConfig.dataDir);
  const eventLog = new JsonSessionEventLog(testConfig.dataDir);
  const connectorService = new ConnectorService(connectorRepository, sops);
  const providerService = new ProviderService(providerRepository, sops);
  const modelCatalog = new ModelCatalog(providerService, sops);

  const mockDocker = new MockDockerPort();
  const fakeHarness = new FakeHarness();
  const piConfigProvisioner = new PiConfigProvisioner(mockDocker, providerRepository, sops);
  const sessionService = new SessionService(
    {
      docker: mockDocker,
      secrets: sops,
      sessions: sessionRepository,
      connectors: connectorRepository,
      providers: providerRepository,
      harness: fakeHarness,
      eventLog,
      config: testConfig,
      piConfigProvisioner,
    },
    20
  );

  app.use("/api/sessions", sessionsApiRouter(sessionService, testConfig));
  app.use("/api/connectors", connectorsApiRouter(connectorService));
  app.use("/api/providers", providersApiRouter(providerService));
  app.use("/api/models", modelsApiRouter(modelCatalog));

  return { app, mockDocker, fakeHarness, sessionService, connectorService, providerService };
}

export async function setupDataDir() {
  await ensureTestFixtures();
  await mkdir(testConfig.dataDir, { recursive: true });
  await emptyConnectors();
  await emptyProviders();
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

async function emptyProviders() {
  const providerPath = path.join(testConfig.dataDir, "providers.json");
  await writeFile(providerPath, "[]");
}

export function getDataDir() {
  return testConfig.dataDir;
}