import { randomUUID } from "crypto";
import type { AgentSession, PermissionPolicy, SessionStatus } from "./types.js";
import { DEFAULT_PROVIDER_ID } from "./types.js";
import type { SessionEvent, SequencedEvent, SequencedEventStream } from "./events.js";
import type { AgentHandle, AgentHarness, EventStream } from "./harness.js";
import type {
  DockerPort,
  SecretsPort,
  SessionRepository,
  ConnectorRepository,
  ProviderRepository,
  SessionEventLog,
} from "./ports.js";
import { SESSION_VOLUME_NAME } from "../infra/docker.js";
import type { Config } from "../config.js";
import { agentContainerId } from "./harness.js";

interface SessionHandle {
  session: AgentSession;
  harness: AgentHandle;
  unsubscribe: () => void;
  subscribers: Set<(e: SequencedEvent) => void>;
  history: SequencedEvent[];
  seqCounter: number;
  containerId: string;
  pendingPersists: Set<Promise<void>>;
  pendingAppends: Set<Promise<void>>;
  draining?: boolean;
}

interface SessionServiceDeps {
  docker: DockerPort;
  secrets: SecretsPort;
  sessions: SessionRepository;
  connectors: ConnectorRepository;
  providers: ProviderRepository;
  harness: AgentHarness;
  eventLog: SessionEventLog;
  config: Config;
  piConfigProvisioner?: { provision(session: AgentSession, containerId: string): Promise<void> };
}

const HISTORY_CAP = 10_000;

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session ${id} not found`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionStoppedError extends Error {
  constructor(id: string) {
    super(`Session ${id} is stopped`);
    this.name = "SessionStoppedError";
  }
}

export class SessionService {
  private handles = new Map<string, SessionHandle>();

  constructor(private deps: SessionServiceDeps, private drainSettleTimeoutMs = 4000) {}

  async resolveAgentEnv(connectorNames: string[], providerId?: string): Promise<Map<string, string>> {
    const connectorsData = await this.deps.connectors.list();
    const selected = connectorsData.filter((c) => connectorNames.includes(c.name));

    const secretFilenames = selected.map((c) => c.secretFile);
    const envVarsMap = await this.deps.secrets.decryptMultiple(secretFilenames);

    const resolvedProviderId = providerId && providerId.trim() ? providerId : DEFAULT_PROVIDER_ID;
    await this.injectProviderEnv(envVarsMap, resolvedProviderId);

    for (const conn of selected) {
      if (conn.url) envVarsMap.set(`${conn.type.toUpperCase()}_URL`, conn.url);
    }

    return envVarsMap;
  }

  private async injectProviderEnv(envVarsMap: Map<string, string>, providerId: string): Promise<void> {
    const provider = await this.deps.providers.get(providerId).catch(() => null);

    if (provider?.secretFile) {
      const secretName = provider.secretFile.replace(/\.(ya?ml)$/, "");
      const exists = await this.deps.secrets.secretExists(secretName).catch(() => false);
      if (exists) {
        const providerEnv = await this.deps.secrets.decryptMultiple([provider.secretFile]);
        for (const [key, value] of providerEnv) {
          envVarsMap.set(key, value);
        }
      }
    }

    if (providerId === DEFAULT_PROVIDER_ID && !envVarsMap.has("OPENCODE_API_KEY")) {
      if (this.deps.config.opencodeGoApiKey) {
        envVarsMap.set("OPENCODE_API_KEY", this.deps.config.opencodeGoApiKey);
      }
      envVarsMap.set("OPENCODE_API_URL", this.deps.config.opencodeGoUrl);
    }
  }

  async createSession(options: {
    connectors?: string[];
    permissionPolicy?: PermissionPolicy;
    model?: string;
    provider?: string;
  }): Promise<AgentSession> {
    const connectors = (options.connectors ?? []).filter(
      (c): c is string => typeof c === "string"
    );
    const permissionPolicy: PermissionPolicy =
      options.permissionPolicy === "manual" ? "manual" : "auto";
    const provider =
      typeof options.provider === "string" && options.provider.trim().length > 0
        ? options.provider.trim()
        : undefined;

    const envVarsMap = await this.resolveAgentEnv(connectors, provider);

    const providerId = provider ?? DEFAULT_PROVIDER_ID;
    const providerRecord = await this.deps.providers.get(providerId).catch(() => null);
    const model = options.model || providerRecord?.defaultModel || this.deps.config.defaultModel;

    const id = randomUUID().slice(0, 8);
    const workspaceVolume = `agent-land-ws-${id}`;

    await this.deps.docker.ensureAgentImage(this.deps.config.agentImage);

    const now = new Date().toISOString();
    const session: AgentSession = {
      id,
      status: "idle",
      permissionPolicy,
      sessionDir: `/sessions/${id}`,
      connectors,
      model,
      provider,
      createdAt: now,
      updatedAt: now,
    };

    let containerId: string | undefined;
    try {
      const container = await this.deps.docker.createInteractiveContainer({
        id,
        envVars: Object.fromEntries(envVarsMap),
        image: this.deps.config.agentImage,
        sessionVolume: SESSION_VOLUME_NAME,
        workspaceVolume,
      });
      containerId = container.id;
      session.containerId = container.id;

      await this.deps.sessions.save(session);

      if (this.deps.piConfigProvisioner) {
        await this.deps.piConfigProvisioner.provision(session, container.id);
      }

      const harness = await this.deps.harness.start(session);
      const handle: SessionHandle = {
        session,
        harness,
        unsubscribe: () => {},
        subscribers: new Set(),
        history: [],
        seqCounter: 0,
        containerId: container.id,
        pendingPersists: new Set(),
        pendingAppends: new Set(),
      };
      handle.unsubscribe = harness.events().subscribe((e) => this.onEvent(handle, e));
      this.handles.set(id, handle);

      return session;
    } catch (err) {
      if (containerId) {
        await this.deps.docker.removeContainer(containerId).catch(() => {});
        await this.deps.docker.removeVolume(workspaceVolume).catch(() => {});
      }
      await this.deps.sessions.delete(id).catch(() => {});
      throw err;
    }
  }

  async listSessions(): Promise<AgentSession[]> {
    return this.deps.sessions.list();
  }

  async getSession(id: string): Promise<AgentSession | null> {
    const handle = this.handles.get(id);
    if (handle) return handle.session;
    return this.deps.sessions.get(id);
  }

  async getEvents(id: string): Promise<SessionEvent[]> {
    const handle = this.handles.get(id);
    if (handle) return handle.history.map((h) => h.event);
    return this.deps.eventLog.read(id).catch(() => []);
  }

  async getSequencedEvents(id: string): Promise<SequencedEvent[]> {
    const handle = this.handles.get(id);
    if (handle) return handle.history.slice();
    const events = await this.deps.eventLog.read(id).catch(() => [] as SessionEvent[]);
    return events.map((event, seq) => ({ seq, event }));
  }

  streamEvents(id: string): SequencedEventStream {
    return {
      subscribe: (handler) => {
        const handle = this.handles.get(id);
        if (!handle) return () => {};
        handle.subscribers.add(handler);
        return () => {
          handle.subscribers.delete(handler);
        };
      },
    };
  }

  async prompt(id: string, message: string, behavior?: "steer" | "followUp"): Promise<void> {
    const handle = this.requireLiveHandle(id);
    await handle.harness.prompt(message, behavior);
    this.setStatus(handle, "running");
    await drainWrites(handle);
  }

  async respond(
    id: string,
    requestId: string,
    value: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ): Promise<void> {
    const handle = this.requireLiveHandle(id);
    await handle.harness.respond(requestId, value);
    handle.session.waitingFor = undefined;
    this.persist(handle);
    this.setStatus(handle, "running");
    await drainWrites(handle);
  }

  async abort(id: string): Promise<void> {
    const handle = this.requireLiveHandle(id);
    await handle.harness.abort();
  }

  async kill(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) {
      const session = await this.deps.sessions.get(id);
      if (!session) throw new SessionNotFoundError(id);
      if (session.status !== "stopped") {
        await this.markStopped(session);
      }
      return;
    }

    try {
      await handle.harness.abort();
    } catch {}
    try {
      await handle.harness.stop();
    } catch {}
    try {
      await this.deps.docker.removeContainer(handle.containerId);
    } catch {}

    handle.subscribers.clear();
    this.setStatus(handle, "stopped");
    await drainWrites(handle);
  }

  async remove(id: string): Promise<void> {
    const session = await this.deps.sessions.get(id);
    if (!session) throw new SessionNotFoundError(id);

    const handle = this.handles.get(id);
    if (handle && handle.session.status !== "stopped") {
      throw new Error(`Session ${id} is still running; kill it first`);
    }

    if (handle) {
      handle.unsubscribe();
      await drainWrites(handle);
    }
    this.handles.delete(id);
    await this.deps.sessions.delete(id);
    await this.deps.eventLog.delete(id);
  }

  async recover(): Promise<void> {
    const sessions = await this.deps.sessions.list();
    for (const session of sessions) {
      if (this.handles.has(session.id)) continue;

      const containerId = agentContainerId(session.id);
      const exists = await this.deps.docker.containerExists(containerId).catch(() => false);

      if (!exists) {
        await this.markStopped(session);
        continue;
      }

      try {
        const history = await this.deps.eventLog.read(session.id);
        const harness = await this.deps.harness.start(session);
        const trimmed = history.slice(-HISTORY_CAP);
        const handle: SessionHandle = {
          session,
          harness,
          unsubscribe: () => {},
          subscribers: new Set(),
          history: trimmed.map((event, seq) => ({ seq, event })),
          seqCounter: trimmed.length,
          containerId,
          pendingPersists: new Set(),
          pendingAppends: new Set(),
        };
        handle.unsubscribe = harness.events().subscribe((e) => this.onEvent(handle, e));
        this.handles.set(session.id, handle);
        await this.markReattached(handle);
      } catch {
        await this.markStopped(session);
      }
    }
  }

  async drainAll(): Promise<void> {
    await Promise.all(
      [...this.handles.values()].map(async (handle) => {
        handle.draining = true;
        const settled = this.waitForSettle(handle);
        try {
          await handle.harness.abort();
        } catch {}
        await settled;
        try {
          await handle.harness.stop();
        } catch {}
      })
    );
  }

  private waitForSettle(handle: SessionHandle): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const timer = setTimeout(finish, this.drainSettleTimeoutMs);
      const unsubscribe = handle.harness.events().subscribe((e) => {
        if (e.type === "agent_settled" || (e.type === "status" && e.status === "stopped")) {
          finish();
        }
      });
    });
  }

  private async markReattached(handle: SessionHandle): Promise<void> {
    handle.session.status = "idle";
    handle.session.waitingFor = undefined;
    handle.session.updatedAt = new Date().toISOString();
    this.persist(handle);
    await drainWrites(handle);
    this.push(handle, { type: "status", status: "idle" });
  }

  private async markStopped(session: AgentSession): Promise<void> {
    session.status = "stopped";
    session.updatedAt = new Date().toISOString();
    await this.deps.sessions.save(session).catch(() => {});
    await this.deps.eventLog
      .append(session.id, { type: "status", status: "stopped" }, HISTORY_CAP)
      .catch(() => {});
  }

  private requireLiveHandle(id: string): SessionHandle {
    const handle = this.handles.get(id);
    if (!handle) throw new SessionNotFoundError(id);
    if (handle.session.status === "stopped") throw new SessionStoppedError(id);
    return handle;
  }

  private onEvent(handle: SessionHandle, event: SessionEvent): void {
    if (handle.draining) return;
    this.push(handle, event);

    switch (event.type) {
      case "status":
        if (event.status === "running" || event.status === "stopped") {
          handle.session.status = event.status;
          handle.session.updatedAt = new Date().toISOString();
          this.persist(handle);
        }
        break;

      case "waiting_for_input":
        if (handle.session.permissionPolicy === "auto") {
          void this.autoRespond(handle, event);
        } else {
          handle.session.status = "waiting_for_input";
          handle.session.waitingFor = {
            requestId: event.requestId,
            method: event.method as NonNullable<AgentSession["waitingFor"]>["method"],
            prompt: event.prompt,
          };
          this.persist(handle);
          this.setStatus(handle, "waiting_for_input");
        }
        break;

      case "agent_settled":
        if (handle.session.permissionPolicy === "manual" && handle.session.waitingFor) {
          this.setStatus(handle, "waiting_for_input");
        } else {
          this.setStatus(handle, "idle");
        }
        break;

      default:
        break;
    }
  }

  private async autoRespond(
    handle: SessionHandle,
    event: Extract<SessionEvent, { type: "waiting_for_input" }>
  ): Promise<void> {
    const value = autoAnswer(event.method, event.options);
    await handle.harness.respond(event.requestId, value).catch(() => {});
  }

  private setStatus(handle: SessionHandle, status: SessionStatus): void {
    const changed = handle.session.status !== status;
    handle.session.status = status;
    handle.session.updatedAt = new Date().toISOString();
    this.persist(handle);
    if (changed) {
      this.push(handle, { type: "status", status });
    }
  }

  private push(handle: SessionHandle, event: SessionEvent): void {
    const seq = handle.seqCounter++;
    handle.history.push({ seq, event });
    if (handle.history.length > HISTORY_CAP) {
      handle.history.splice(0, handle.history.length - HISTORY_CAP);
    }
    trackWrite(handle.pendingAppends, () =>
      this.deps.eventLog.append(handle.session.id, event, HISTORY_CAP)
    );
    const sequenced: SequencedEvent = { seq, event };
    for (const subscriber of handle.subscribers) {
      try {
        subscriber(sequenced);
      } catch {}
    }
  }

  private persist(handle: SessionHandle): void {
    trackWrite(handle.pendingPersists, () => this.deps.sessions.save(handle.session));
  }
}

function trackWrite(pending: Set<Promise<void>>, write: () => Promise<unknown>): void {
  const p = write().then(
    () => undefined,
    () => undefined
  );
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

async function drainWrites(handle: SessionHandle): Promise<void> {
  while (handle.pendingPersists.size > 0 || handle.pendingAppends.size > 0) {
    await Promise.all([...handle.pendingPersists, ...handle.pendingAppends]);
  }
}

function autoAnswer(
  method: string,
  options?: string[]
): { value?: string; confirmed?: boolean; cancelled?: boolean } {
  switch (method) {
    case "confirm":
      return { confirmed: true };
    case "select":
      return { value: options?.[0] ?? "" };
    case "input":
    case "editor":
      return { value: "" };
    default:
      return { value: "" };
  }
}
