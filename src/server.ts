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
import { SopsService } from "./services/sops.js";
import { DockerService } from "./services/docker.js";
import { startSshServer } from "./services/ssh-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = getConfig();

const sops = new SopsService(config.secretsDir, config.ageKeyFile);

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

app.use("/", indexRouter());
app.use("/agents", agentsRouter(sops));
app.use("/connectors", connectorsRouter(sops));

const docker = new DockerService();

app.listen(config.port, () => {
  console.log(`Agent Land orchestrator running on http://localhost:${config.port}`);
});

startSshServer({ sops, docker, config }).catch((err) => {
  console.error("SSH server failed to start:", err);
});
