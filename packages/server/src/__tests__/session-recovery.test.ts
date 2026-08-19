import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import path from "path";
import {
  createAgentTestApp,
  setupDataDir,
  cleanupDataDir,
  getDataDir,
} from "./helpers/setup.js";
import { JsonSessionEventLog } from "../infra/repositories.js";
import type { AgentSession } from "../core/types.js";
import type { SessionEvent } from "../core/events.js";

function containerName(id: string): string {
  return `agent-land-pi-${id}`;
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const id = overrides.id ?? "abc12345";
  return {
    id,
    status: "running",
    permissionPolicy: "auto",
    sessionDir: `/sessions/${id}`,
    connectors: [],
    model: "test-model",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function persistSession(session: AgentSession): Promise<void> {
  const dir = path.join(getDataDir(), "sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
}

async function readPersistedSession(id: string): Promise<AgentSession> {
  const file = path.join(getDataDir(), "sessions", `${id}.json`);
  return JSON.parse(await readFile(file, "utf-8"));
}

describe("Session recovery", () => {
  let ctx: ReturnType<typeof createAgentTestApp>;

  beforeEach(async () => {
    await setupDataDir();
    await rm(path.join(getDataDir(), "sessions"), { recursive: true, force: true });
    ctx = createAgentTestApp();
  });

  it("re-attaches persisted sessions whose container still exists", async () => {
    const session = makeSession({ status: "running" });
    await persistSession(session);
    ctx.mockDocker.containers.add(containerName(session.id));

    await ctx.sessionService.recover();

    expect(ctx.fakeHarness.handles.length).toBe(1);
    const persisted = await readPersistedSession(session.id);
    expect(persisted.status).toBe("idle");

    const events = await ctx.sessionService.getEvents(session.id);
    expect(events.at(-1)).toEqual({ type: "status", status: "idle" });
  });

  it("marks orphaned sessions stopped when the container is missing", async () => {
    const session = makeSession({ status: "running" });
    await persistSession(session);

    await ctx.sessionService.recover();

    expect(ctx.fakeHarness.handles.length).toBe(0);
    const persisted = await readPersistedSession(session.id);
    expect(persisted.status).toBe("stopped");

    const events = await ctx.sessionService.getEvents(session.id);
    expect(events.at(-1)).toEqual({ type: "status", status: "stopped" });
  });

  it("kill marks a persisted session stopped when no live handle exists", async () => {
    const session = makeSession({ status: "running" });
    await persistSession(session);

    await expect(ctx.sessionService.kill(session.id)).resolves.toBeUndefined();

    const persisted = await readPersistedSession(session.id);
    expect(persisted.status).toBe("stopped");
  });

  it("kill throws for an unknown session id", async () => {
    await expect(ctx.sessionService.kill("doesnotexist")).rejects.toThrow(/not found/);
  });

  it("re-attaches sessions whose persisted status says stopped but the container still exists", async () => {
    const session = makeSession({ status: "stopped" });
    await persistSession(session);
    ctx.mockDocker.containers.add(containerName(session.id));

    await ctx.sessionService.recover();

    expect(ctx.fakeHarness.handles.length).toBe(1);
    const persisted = await readPersistedSession(session.id);
    expect(persisted.status).toBe("idle");
  });

  it("clears a stale waitingFor when re-attaching a waiting session", async () => {
    const session = makeSession({
      status: "waiting_for_input",
      waitingFor: { requestId: "req-1", method: "confirm" },
    });
    await persistSession(session);
    ctx.mockDocker.containers.add(containerName(session.id));

    await ctx.sessionService.recover();

    const persisted = await readPersistedSession(session.id);
    expect(persisted.waitingFor).toBeUndefined();
    expect(persisted.status).toBe("idle");
  });

  it("replays the persisted event log into the recovered handle", async () => {
    const session = makeSession({ status: "running" });
    await persistSession(session);
    ctx.mockDocker.containers.add(containerName(session.id));

    const prior: SessionEvent[] = [
      { type: "turn_start" },
      { type: "message_end", message: { role: "assistant", content: "hello" } },
    ];
    const logPath = path.join(getDataDir(), "sessions", `${session.id}.events.jsonl`);
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, prior.map((e) => JSON.stringify(e)).join("\n") + "\n");

    await ctx.sessionService.recover();

    const events = await ctx.sessionService.getEvents(session.id);
    expect(events.slice(0, prior.length)).toEqual(prior);
    expect(events.at(-1)).toEqual({ type: "status", status: "idle" });
  });

  it("aborts and stops every live harness on drain without persisting stopped", async () => {
    const first = await ctx.sessionService.createSession({});
    await ctx.sessionService.createSession({});
    expect(ctx.fakeHarness.handles.length).toBe(2);

    await ctx.sessionService.drainAll();

    for (const handle of ctx.fakeHarness.handles) {
      expect(handle.aborted).toBe(true);
      expect(handle.stopped).toBe(true);
    }
    expect((await readPersistedSession(first.id)).status).not.toBe("stopped");
  });

  it("re-attaches a drained session in a fresh service instance", async () => {
    const session = await ctx.sessionService.createSession({});
    await ctx.sessionService.drainAll();
    expect(ctx.fakeHarness.handles.length).toBe(1);

    const ctx2 = createAgentTestApp();
    ctx2.mockDocker.containers.add(containerName(session.id));

    await ctx2.sessionService.recover();

    expect(ctx2.fakeHarness.handles.length).toBe(1);
    const persisted = await readPersistedSession(session.id);
    expect(persisted.status).toBe("idle");
  });
});

describe("Session event log", () => {
  beforeEach(async () => {
    await setupDataDir();
    await rm(path.join(getDataDir(), "sessions"), { recursive: true, force: true });
  });

  it("persists events as jsonl and trims to the cap", async () => {
    const log = new JsonSessionEventLog(getDataDir());
    await log.append("s1", { type: "turn_start" }, 3);
    await log.append("s1", { type: "agent_settled" }, 3);
    await log.append("s1", { type: "status", status: "idle" }, 3);
    await log.append("s1", { type: "status", status: "running" }, 3);

    expect(await log.read("s1")).toEqual([
      { type: "agent_settled" },
      { type: "status", status: "idle" },
      { type: "status", status: "running" },
    ]);
  });

  it("returns an empty list when no log exists", async () => {
    const log = new JsonSessionEventLog(getDataDir());
    expect(await log.read("missing")).toEqual([]);
  });

  it("keeps every event when appends race", async () => {
    const log = new JsonSessionEventLog(getDataDir());
    const events: SessionEvent[] = Array.from({ length: 50 }, (_, i) => ({
      type: "message_delta",
      text: `d${i}`,
    }));

    await Promise.all(events.map((e) => log.append("race", e, 100)));

    const read = await log.read("race");
    expect(read).toEqual(events);
  });
});

afterAll(async () => {
  await cleanupDataDir();
});
