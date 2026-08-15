import { randomUUID } from "crypto";
import type { AgentSession, PermissionPolicy, SessionStatus } from "./types.js";
import type { SessionEvent } from "./events.js";
import type { AgentHandle, AgentHarness, EventStream } from "./harness.js";
import type { DockerPort, SecretsPort, SessionRepository, ConnectorRepository } from "./ports.js";
import { SESSION_VOLUME_NAME } from "../infra/docker.js";
import type { Config } from "../config.js";

interface SessionHandle {
  session: AgentSession;
  harness: AgentHandle;
  subscribers: Set<(e: SessionEvent) => void>;
  history: SessionEvent[];
  containerId: string;
}

interface SessionServiceDeps {
  docker: DockerPort;
  secrets: SecretsPort;
  sessions: SessionRepository;
  connectors: ConnectorRepository;
  harness: AgentHarness;
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

  constructor(private deps: SessionServiceDeps) {}

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
  }): Promise<AgentSession> {
    const connectors = (options.connectors ?? []).filter(
      (c): c is string => typeof c === "string"
    );
    const permissionPolicy: PermissionPolicy =
      options.permissionPolicy === "manual" ? "manual" : "auto";
    const model = options.model || this.deps.config.defaultModel;
    const id = randomUUID().slice(0, 8);

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
    };

    let containerId: string | undefined;
    try {
      const container = await this.deps.docker.createInteractiveContainer({
        id,
        envVars: Object.fromEntries(envVarsMap),
        image: this.deps.config.agentImage,
        sessionVolume: SESSION_VOLUME_NAME,
      });
      containerId = container.id;
      session.containerId = container.id;

      await this.deps.sessions.save(session);

      const harness = await this.deps.harness.start(session);
      const handle: SessionHandle = {
        session,
        harness,
        subscribers: new Set(),
        history: [],
        containerId: container.id,
      };
      this.handles.set(id, handle);
      harness.events().subscribe((e) => this.onEvent(handle, e));

      return session;
    } catch (err) {
      if (containerId) {
        await this.deps.docker.removeContainer(containerId).catch(() => {});
      }
      await this.deps.sessions.delete(id).catch(() => {});
      throw err;
    }
  }

  async listSessions(): Promise<AgentSession[]> {
    return this.deps.sessions.list();
  }

  async getSession(id: string): Promise<AgentSession | null> {
    return this.deps.sessions.get(id);
  }

  getEvents(id: string): SessionEvent[] {
    return this.handles.get(id)?.history ?? [];
  }

  streamEvents(id: string): EventStream {
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
  }

  private requireLiveHandle(id: string): SessionHandle {
    const handle = this.handles.get(id);
    if (!handle) throw new SessionNotFoundError(id);
    if (handle.session.status === "stopped") throw new SessionStoppedError(id);
    return handle;
  }

  private onEvent(handle: SessionHandle, event: SessionEvent): void {
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
    handle.history.push(event);
    if (handle.history.length > HISTORY_CAP) {
      handle.history.splice(0, handle.history.length - HISTORY_CAP);
    }
    for (const subscriber of handle.subscribers) {
      try {
        subscriber(event);
      } catch {}
    }
  }

  private async persist(handle: SessionHandle): Promise<void> {
    await this.deps.sessions.save(handle.session).catch(() => {});
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
