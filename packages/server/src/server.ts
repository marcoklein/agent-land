import "dotenv/config";
import express from "express";
import session from "express-session";
import flash from "connect-flash";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { getConfig } from "./config.js";
import { indexRouter } from "./routes/index.js";
import { agentsRouter } from "./routes/agents.js";
import { connectorsRouter } from "./routes/connectors.js";
import { providersRouter } from "./routes/providers.js";
import { copilotRouter } from "./routes/copilot.js";
import { SopsService } from "./infra/sops.js";
import { DockerService } from "./infra/docker.js";
import { PiRpcHarness } from "./infra/pi-rpc-harness.js";
import { GitCloneProvisioner } from "./infra/git-clone-provisioner.js";
import { PiConfigProvisioner } from "./infra/pi-config-provisioner.js";
import {
  JsonSessionRepository,
  JsonConnectorRepository,
  JsonSessionEventLog,
  JsonProviderRepository,
} from "./infra/repositories.js";
import { SessionService } from "./core/session-service.js";
import { ConnectorService } from "./core/connector-service.js";
import { ProviderService } from "./core/provider-service.js";
import { ModelCatalog } from "./infra/model-catalog.js";
import { sessionsApiRouter } from "./presentation/http/api-sessions.js";
import { connectorsApiRouter } from "./presentation/http/api-connectors.js";
import { providersApiRouter } from "./presentation/http/api-providers.js";
import { copilotApiRouter } from "./presentation/http/api-copilot.js";
import { modelsApiRouter } from "./presentation/http/api-models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = getConfig();

const sops = new SopsService(config.secretsDir, config.ageKeyFile);
const docker = new DockerService();
const sessionRepository = new JsonSessionRepository(config.dataDir);
const connectorRepository = new JsonConnectorRepository(config.dataDir);
const providerRepository = new JsonProviderRepository(config.dataDir);
const eventLog = new JsonSessionEventLog(config.dataDir);

const connectorService = new ConnectorService(connectorRepository, sops);
const providerService = new ProviderService(providerRepository, sops);
const modelCatalog = new ModelCatalog(providerService, sops);
const harness = new PiRpcHarness(docker);
const provisioner = new GitCloneProvisioner(docker, {
  gitUserName: config.gitUserName,
  gitUserEmail: config.gitUserEmail,
});
const piConfigProvisioner = new PiConfigProvisioner(docker, providerRepository, sops);
const sessionService = new SessionService({
  docker,
  secrets: sops,
  sessions: sessionRepository,
  connectors: connectorRepository,
  providers: providerRepository,
  harness,
  provisioner,
  eventLog,
  config,
  piConfigProvisioner,
});

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "..", "public")));
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

app.use("/", indexRouter(sessionService, connectorService));
app.use("/agents", agentsRouter(sessionService, connectorService, providerService, modelCatalog));
app.use("/connectors", connectorsRouter(connectorService));
app.use("/providers/copilot", copilotRouter(providerService));
app.use("/providers", providersRouter(providerService));
app.use("/api/sessions", sessionsApiRouter(sessionService, config));
app.use("/api/connectors", connectorsApiRouter(connectorService));
app.use("/api/providers/copilot", copilotApiRouter(providerService));
app.use("/api/providers", providersApiRouter(providerService));
app.use("/api/models", modelsApiRouter(modelCatalog));

await sessionService.recover().catch((err) => {
  console.error("Session recovery failed:", err);
});

const server = app.listen(config.port, () => {
  console.log(`Agent Land orchestrator running on http://localhost:${config.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, draining agent sessions...`);
  await sessionService.drainAll().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
