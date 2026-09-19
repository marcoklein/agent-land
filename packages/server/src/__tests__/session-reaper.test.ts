import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import {
  createAgentTestApp,
  setupDataDir,
  cleanupDataDir,
  getDataDir,
} from "./helpers/setup.js";
import type { AgentSession } from "../core/types.js";

function containerName(id: string): string {
  return `agent-land-pi-${id}`;
}

function workspaceVolumeName(id: string): string {
  return `agent-land-ws-${id}`;
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const id = overrides.id ?? "abc12345";
  return {
    id,
    status: "idle",
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

describe("Session reaper", () => {
  let ctx: ReturnType<typeof createAgentTestApp>;

  beforeEach(async () => {
    await setupDataDir();
    await rm(path.join(getDataDir(), "sessions"), { recursive: true, force: true });
    ctx = createAgentTestApp();
  });

  it("remove() also drops the workspace volume", async () => {
    const session = makeSession({ status: "stopped" });
    await persistSession(session);

    await ctx.sessionService.remove(session.id);

    expect(ctx.mockDocker.removedVolumes).toContain(workspaceVolumeName(session.id));
    expect(await ctx.sessionService.getSession(session.id)).toBeNull();
  });

  it("reaps idle sessions past the TTL and leaves recent ones alone", async () => {
    const stale = makeSession({ id: "stale0001", updatedAt: "2000-01-01T00:00:00Z" });
    const recent = makeSession({ id: "recent001" });
    await persistSession(stale);
    await persistSession(recent);
    ctx.mockDocker.containers.add(containerName(stale.id));
    ctx.mockDocker.containers.add(containerName(recent.id));

    const reaped = await ctx.sessionService.reapIdleSessions();

    expect(reaped).toBe(1);
    expect(await ctx.sessionService.getSession(stale.id)).toBeNull();
    expect(await ctx.sessionService.getSession(recent.id)).not.toBeNull();
  });

  it("leaves running and waiting sessions alone regardless of age", async () => {
    const running = makeSession({ id: "running01", status: "running", updatedAt: "2000-01-01T00:00:00Z" });
    const waiting = makeSession({
      id: "waiting01",
      status: "waiting_for_input",
      updatedAt: "2000-01-01T00:00:00Z",
    });
    await persistSession(running);
    await persistSession(waiting);
    ctx.mockDocker.containers.add(containerName(running.id));
    ctx.mockDocker.containers.add(containerName(waiting.id));

    const reaped = await ctx.sessionService.reapIdleSessions();

    expect(reaped).toBe(0);
    expect(await ctx.sessionService.getSession(running.id)).not.toBeNull();
    expect(await ctx.sessionService.getSession(waiting.id)).not.toBeNull();
  });

  it("stops the oldest idle session when the live cap is exceeded", async () => {
    const capped = createAgentTestApp({ sessionMaxLive: 2 });
    const oldest = makeSession({ id: "oldest001", createdAt: "2026-01-01T00:00:00Z" });
    const middle = makeSession({ id: "middle001", createdAt: "2026-01-02T00:00:00Z" });
    const newest = makeSession({ id: "newest001", createdAt: "2026-01-03T00:00:00Z" });
    await persistSession(oldest);
    await persistSession(middle);
    await persistSession(newest);
    capped.mockDocker.containers.add(containerName(oldest.id));
    capped.mockDocker.containers.add(containerName(middle.id));
    capped.mockDocker.containers.add(containerName(newest.id));

    const reaped = await capped.sessionService.reapIdleSessions();

    expect(reaped).toBe(1);
    expect(await capped.sessionService.getSession(oldest.id)).toBeNull();
    expect(await capped.sessionService.getSession(middle.id)).not.toBeNull();
    expect(await capped.sessionService.getSession(newest.id)).not.toBeNull();
  });

  it("respects the cap when no session is idle enough to stop", async () => {
    const capped = createAgentTestApp({ sessionMaxLive: 1 });
    const a = await capped.sessionService.createSession({});
    await capped.sessionService.prompt(a.id, "work");

    await capped.sessionService.reapIdleSessions();

    expect(await capped.sessionService.getSession(a.id)).not.toBeNull();
  });
});

afterAll(async () => {
  await cleanupDataDir();
});
