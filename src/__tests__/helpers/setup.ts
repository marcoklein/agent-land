import express from "express";
import session from "express-session";
import flash from "connect-flash";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, rm, writeFile } from "fs/promises";
import { PassThrough } from "stream";
import { SopsService } from "../../services/sops.js";
import { connectorsRouter } from "../../routes/connectors.js";
import { agentsRouter } from "../../routes/agents.js";
import { getConfig } from "../../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testConfig = getConfig();

export function createTestApp() {
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

  const sops = new SopsService(testConfig.secretsDir, testConfig.ageKeyFile);
  app.use("/connectors", connectorsRouter(sops));

  return app;
}

export class MockDockerService {
  logStream = new PassThrough();
  private _stopCalled = false;
  private _exitResolve?: (code: number) => void;
  private _exitPromise: Promise<number>;

  constructor() {
    this._exitPromise = new Promise((resolve) => {
      this._exitResolve = resolve;
    });
  }

  get stopCalled() { return this._stopCalled; }

  async createAndStartContainer(_options: any) {
    return { id: "mock-container-id" };
  }

  async streamLogs(_containerId: string) {
    return this.logStream;
  }

  async waitForExit(_containerId: string): Promise<number> {
    return this._exitPromise;
  }

  resolveExit(code: number) {
    this._exitResolve?.(code);
  }

  async stopContainer(_id: string) {
    this._stopCalled = true;
    this.logStream.end();
  }

  async removeContainer(_id: string) {}

  async ensureAgentImage(_image: string) {}
}

export function createAgentTestApp(mockDocker: MockDockerService) {
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

  const sops = new SopsService(testConfig.secretsDir, testConfig.ageKeyFile);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use("/agents", agentsRouter(sops, mockDocker as any));

  return app;
}

export async function setupDataDir() {
  await mkdir(testConfig.dataDir, { recursive: true });
  await emptyConnectors();
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
