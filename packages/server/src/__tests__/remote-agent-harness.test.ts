import { describe, it, expect } from "vitest";
import { RemoteAgentHarness } from "../infra/remote-agent-harness.js";
import type { RunnerConnection, RunnerTransport } from "../core/runner-transport.js";
import type { RunnerMessage } from "../core/runner-protocol.js";
import type { AgentSession } from "../core/types.js";
import type { SessionEvent } from "../core/events.js";

class FakeRunnerConnection implements RunnerConnection {
  sent: RunnerMessage[] = [];
  closed = false;
  private messageHandlers = new Set<(m: RunnerMessage) => void>();
  private closeHandlers = new Set<() => void>();

  async send(message: RunnerMessage) {
    this.sent.push(message);
  }

  onMessage(handler: (m: RunnerMessage) => void) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onClose(handler: () => void) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  async close() {
    this.closed = true;
    for (const h of this.closeHandlers) h();
  }

  deliver(message: RunnerMessage) {
    for (const h of this.messageHandlers) h(message);
  }
}

class FakeRunnerTransport implements RunnerTransport {
  conn = new FakeRunnerConnection();
  async accept(_session: AgentSession, _opts: { lastAckedSeq: number; timeoutMs?: number }) {
    return this.conn;
  }
  abandon(_sessionId: string) {}
}

class ReconnectingTransport implements RunnerTransport {
  conns: FakeRunnerConnection[] = [];
  acceptCount = 0;

  async accept(_session: AgentSession, _opts: { lastAckedSeq: number; timeoutMs?: number }) {
    const conn = this.conns[Math.min(this.acceptCount, this.conns.length - 1)];
    this.acceptCount++;
    return conn;
  }
  abandon(_sessionId: string) {}
}

function makeSession(): AgentSession {
  return {
    id: "abc123",
    status: "idle",
    permissionPolicy: "auto",
    sessionDir: "/sessions/abc123",
    connectors: [],
    model: "deepseek-v4-pro",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runtime: "runner",
  };
}

describe("RemoteAgentHarness", () => {
  it("replays buffered events to the first subscriber, then streams live", async () => {
    const transport = new FakeRunnerTransport();
    const harness = new RemoteAgentHarness(transport);
    const handle = await harness.start(makeSession());

    transport.conn.deliver({ type: "event", seq: 1, event: { type: "turn_start" } });

    const got: SessionEvent[] = [];
    handle.events().subscribe((e) => got.push(e));
    expect(got).toContainEqual({ type: "turn_start" });

    transport.conn.deliver({
      type: "event_batch",
      events: [
        { seq: 2, event: { type: "message_delta", text: "x" } },
        { seq: 3, event: { type: "agent_settled" } },
      ],
    });
    expect(got).toContainEqual({ type: "message_delta", text: "x" });
    expect(got).toContainEqual({ type: "agent_settled" });
  });

  it("sends a prompt command and resolves on command_result", async () => {
    const transport = new FakeRunnerTransport();
    const harness = new RemoteAgentHarness(transport);
    const handle = await harness.start(makeSession());

    const pending = handle.prompt("hello", "steer");
    expect(transport.conn.sent.length).toBe(1);

    const cmd = transport.conn.sent[0] as Extract<RunnerMessage, { type: "command" }>;
    expect(cmd.type).toBe("command");
    expect(cmd.name).toBe("prompt");
    expect(cmd.payload).toEqual({ message: "hello", behavior: "steer" });

    transport.conn.deliver({ type: "command_result", id: cmd.id, ok: true });
    await expect(pending).resolves.toBeUndefined();
  });

  it("maps respond and abort to command frames", async () => {
    const transport = new FakeRunnerTransport();
    const harness = new RemoteAgentHarness(transport);
    const handle = await harness.start(makeSession());

    const responded = handle.respond("req-1", { confirmed: true });
    const aborted = handle.abort();

    for (const m of transport.conn.sent) {
      if (m.type === "command") {
        transport.conn.deliver({ type: "command_result", id: m.id, ok: true });
      }
    }
    await Promise.all([responded, aborted]);

    const names = transport.conn.sent.map((m) => (m as { name?: string }).name);
    expect(names).toEqual(["respond", "abort"]);
  });

  it("stop() closes the channel without killing pi", async () => {
    const transport = new FakeRunnerTransport();
    const harness = new RemoteAgentHarness(transport);
    const handle = await harness.start(makeSession());

    await handle.stop();
    expect(transport.conn.closed).toBe(true);
  });
});

describe("RemoteAgentHarness reconnection", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("re-accepts after a channel drop without emitting stopped", async () => {
    const transport = new ReconnectingTransport();
    transport.conns = [new FakeRunnerConnection(), new FakeRunnerConnection()];
    const harness = new RemoteAgentHarness(transport);
    const handle = await harness.start(makeSession());

    const got: SessionEvent[] = [];
    handle.events().subscribe((e) => got.push(e));

    transport.conns[0].deliver({ type: "event", seq: 1, event: { type: "turn_start" } });
    expect(got).toContainEqual({ type: "turn_start" });

    transport.conns[0].close();
    await flush();

    transport.conns[1].deliver({ type: "event", seq: 2, event: { type: "agent_settled" } });
    expect(got).toContainEqual({ type: "agent_settled" });
    expect(got).not.toContainEqual({ type: "status", status: "stopped" });
  });

  it("dedupes replayed events by runner seq across a reconnect", async () => {
    const transport = new ReconnectingTransport();
    transport.conns = [new FakeRunnerConnection(), new FakeRunnerConnection()];
    const harness = new RemoteAgentHarness(transport);
    const handle = await harness.start(makeSession());

    const got: SessionEvent[] = [];
    handle.events().subscribe((e) => got.push(e));

    transport.conns[0].deliver({ type: "event", seq: 1, event: { type: "turn_start" } });
    transport.conns[0].deliver({ type: "event", seq: 2, event: { type: "agent_settled" } });

    transport.conns[0].close();
    await flush();

    transport.conns[1].deliver({
      type: "event_batch",
      events: [
        { seq: 2, event: { type: "agent_settled" } },
        { seq: 3, event: { type: "status", status: "stopped" } },
      ],
    });

    expect(got.filter((e) => e.type === "agent_settled").length).toBe(1);
    expect(got).toContainEqual({ type: "status", status: "stopped" });
  });
});
