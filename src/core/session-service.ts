import { randomUUID } from "crypto";
import type { AgentSession, PermissionPolicy, SessionStatus, WorkspaceSpec } from "./types.js";
import type { SessionEvent, SequencedEvent, SequencedEventStream } from "./events.js";
import type { AgentHandle, AgentHarness, EventStream } from "./harness.js";
import type {
  DockerPort,
  SecretsPort,
  SessionRepository,
  ConnectorRepository,
  WorkspaceProvisioner,
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
  history: SessionEvent[];
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
  harness: AgentHarness;
  provisioner: WorkspaceProvisioner;
  eventLog: SessionEventLog;
  config: Config;
}

const HISTORY_CAP = 10_000;

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session ${id} is not running`);
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

  async resolveAgentEnv(connectorNames: string[]): Promise<Map<string, string>> {
    const connectorsData = await this.deps.connectors.list();
    const selected = connectorsData.filter((c) => connectorNames.includes(c.name));

    const secretFilenames = selected.map((c) => c.secretFile);
    const envVarsMap = await this.deps.secrets.decryptMultiple(secretFilenames);

    envVarsMap.set("OPENCODE_API_KEY", this.deps.config.opencodeGoApiKey);
    envVarsMap.set("OPENCODE_API_URL", this.deps.config.opencodeGoUrl);

    for (const conn of selected) {
      if (conn.url) envVarsMap.set(`${conn.type.toUpperCase()}_URL`, conn.url);
    }

    return envVarsMap;
  }

  async createSession(options: {
    connectors?: string[];
    permissionPolicy?: PermissionPolicy;
    model?: string;
    workspace?: WorkspaceSpec;
  }): Promise<AgentSession> {
    const connectors = (options.connectors ?? []).filter(
      (c): c is string => typeof c === "string"
    );
    const permissionPolicy: PermissionPolicy =
      options.permissionPolicy === "manual" ? "manual" : "auto";
    const model = options.model || this.deps.config.defaultModel;
    const id = randomUUID().slice(0, 8);
    const workspace = options.workspace ?? undefined;
    const workspaceVolume = `agent-land-ws-${id}`;

    const envVarsMap = await this.resolveAgentEnv(connectors);
    await this.deps.docker.ensureAgentImage(this.deps.config.agentImage);

    const now = new Date().toISOString();
    const session: AgentSession = {
      id,
      status: "idle",
      permissionPolicy,
      sessionDir: `/sessions/${id}`,
      connectors,
      model,
      createdAt: now,
      updatedAt: now,
      workspace,
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

      if (workspace) {
        await this.deps.provisioner.provision(session, container.id, Object.fromEntries(envVarsMap));
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
        if (workspace) {
          await this.deps.docker.removeVolume(workspaceVolume).catch(() => {});
        }
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
    if (handle) return handle.history;
    return this.deps.eventLog.read(id).catch(() => []);
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
    if (!handle) throw new SessionNotFoundError(id);

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
        const handle: SessionHandle = {
          session,
          harness,
          unsubscribe: () => {},
          subscribers: new Set(),
          history: history.slice(-HISTORY_CAP),
          seqCounter: history.slice(-HISTORY_CAP).length,
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
    handle.history.push(event);
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
