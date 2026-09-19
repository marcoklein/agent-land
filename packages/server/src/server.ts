import "dotenv/config";
import express from "express";
import { getConfig } from "./config.js";
import { SopsService } from "./infra/sops.js";
import { DockerService } from "./infra/docker.js";
import { RemoteAgentHarness } from "./infra/remote-agent-harness.js";
import { SsePostRunnerTransport } from "./infra/sse-post-runner-transport.js";
import { PiConfigProvisioner } from "./infra/pi-config-provisioner.js";
import { computeAgentImageTag } from "./infra/agent-image.js";
import {
  JsonSessionRepository,
  JsonConnectorRepository,
  JsonSessionEventLog,
  JsonProviderRepository,
  JsonMountRepository,
} from "./infra/repositories.js";
import { SessionService } from "./core/session-service.js";
import { ConnectorService } from "./core/connector-service.js";
import { ProviderService } from "./core/provider-service.js";
import { MountService } from "./core/mount-service.js";
import { ModelCatalog } from "./infra/model-catalog.js";
import { sessionsApiRouter } from "./presentation/http/api-sessions.js";
import { connectorsApiRouter } from "./presentation/http/api-connectors.js";
import { providersApiRouter } from "./presentation/http/api-providers.js";
import { modelsApiRouter } from "./presentation/http/api-models.js";
import { mountsApiRouter } from "./presentation/http/api-mounts.js";
import { createApiAuthMiddleware } from "./presentation/http/auth.js";

const config = getConfig();

// Derive the agent image tag from the baked-in /agent-image contents unless the
// operator pinned one explicitly. Content-hashing means a runner change yields a
// new tag that `ensureAgentImage` will build instead of reusing a stale image.
if (!process.env.AGENT_IMAGE) {
  config.agentImage = await computeAgentImageTag(config.agentImageDir);
}

// Hard-exit backstop for shutdown: SSE streams are long-lived, so a bare
// `server.close()` may never finish. Keep the whole exit inside Dokku's ~30s
// SIGTERM grace.
const SHUTDOWN_GRACE_MS = 3_000;

const sops = new SopsService(config.secretsDir, config.ageKeyFile);
const docker = new DockerService();
const sessionRepository = new JsonSessionRepository(config.dataDir);
const connectorRepository = new JsonConnectorRepository(config.dataDir);
const providerRepository = new JsonProviderRepository(config.dataDir);
const mountRepository = new JsonMountRepository(config.dataDir);
const eventLog = new JsonSessionEventLog(config.dataDir);

const connectorService = new ConnectorService(connectorRepository, sops);
const providerService = new ProviderService(providerRepository, sops);
const modelCatalog = new ModelCatalog(providerService, sops);
const mountService = new MountService(mountRepository, docker, sessionRepository);
const runnerTransport = new SsePostRunnerTransport();
const runnerHarness = new RemoteAgentHarness(runnerTransport);
const piConfigProvisioner = new PiConfigProvisioner(docker, providerRepository, sops);
const sessionService = new SessionService({
  docker,
  secrets: sops,
  sessions: sessionRepository,
  connectors: connectorRepository,
  providers: providerRepository,
  mounts: mountRepository,
  runnerHarness,
  eventLog,
  config,
  piConfigProvisioner,
});

const app = express();

app.use(express.json());

// Unauthenticated liveness probe for Dokku zero-downtime checks (CHECKS file).
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", createApiAuthMiddleware(sessionService, config));

app.use("/api/sessions", sessionsApiRouter(sessionService, config));
app.use("/api/connectors", connectorsApiRouter(connectorService));
app.use("/api/providers", providersApiRouter(providerService));
app.use("/api/models", modelsApiRouter(modelCatalog));
app.use("/api/mounts", mountsApiRouter(mountService));

app.use("/engine/runner", createApiAuthMiddleware(sessionService, config), runnerTransport.router());

await sessionService.recover().catch((err) => {
  console.error("Session recovery failed:", err);
});

const reapTimer = setInterval(() => {
  void sessionService.reapIdleSessions().catch((err) => {
    console.error("Session reaper failed:", err);
  });
}, config.sessionReapIntervalMs);
reapTimer.unref?.();

const server = app.listen(config.port, () => {
  console.log(`Agent Land orchestrator running on http://localhost:${config.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, closing HTTP...`);
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  server.close(() => process.exit(0));
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));