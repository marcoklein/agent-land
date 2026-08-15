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
import { SopsService } from "./infra/sops.js";
import { DockerService } from "./infra/docker.js";
import { PiRpcHarness } from "./infra/pi-rpc-harness.js";
import { JsonSessionRepository, JsonConnectorRepository } from "./infra/repositories.js";
import { SessionService } from "./core/session-service.js";
import { ConnectorService } from "./core/connector-service.js";
import { sessionsApiRouter } from "./presentation/http/api-sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = getConfig();

const sops = new SopsService(config.secretsDir, config.ageKeyFile);
const docker = new DockerService();
const sessionRepository = new JsonSessionRepository(config.dataDir);
const connectorRepository = new JsonConnectorRepository(config.dataDir);

const connectorService = new ConnectorService(connectorRepository, sops);
const harness = new PiRpcHarness(docker);
const sessionService = new SessionService({
  docker,
  secrets: sops,
  sessions: sessionRepository,
  connectors: connectorRepository,
  harness,
  config,
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
app.use("/agents", agentsRouter(sessionService, connectorService));
app.use("/connectors", connectorsRouter(connectorService));
app.use("/api/sessions", sessionsApiRouter(sessionService));

app.listen(config.port, () => {
  console.log(`Agent Land orchestrator running on http://localhost:${config.port}`);
});
