import type { AgentHarness, AgentHandle, EventStream } from "../core/harness.js";
import type { SessionEvent } from "../core/events.js";
import type { AgentSession } from "../core/types.js";
import type { RunnerConnection, RunnerTransport } from "../core/runner-transport.js";
import type { RunnerMessage } from "../core/runner-protocol.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Second `AgentHarness` implementation: talks to the in-container runner over a
 * reconnectable channel instead of owning pi's `docker exec` stream. A dropped
 * channel is not a session death — the harness re-accepts the runner's next
 * registration, dedupes replayed events by runner seq, and keeps emitting. Only
 * an explicit `stop()` (or a `status: stopped` event from the runner) ends the
 * stream; `stop()` detaches the channel and never kills pi.
 */
export class RemoteAgentHarness implements AgentHarness {
  constructor(private transport: RunnerTransport, private acceptTimeoutMs = 10_000) {}

  async start(session: AgentSession): Promise<AgentHandle> {
    const handlers = new Set<(e: SessionEvent) => void>();
    let buffer: SessionEvent[] | null = [];
    const emit = (e: SessionEvent) => {
      if (buffer) {
        buffer.push(e);
        return;
      }
      for (const h of handlers) h(e);
    };

    let stopped = false;
    let commandSeq = 0;
    let lastAckedSeq = 0;
    let current: RunnerConnection | null = null;
    const pending = new Map<string, (r: { ok: boolean; error?: string }) => void>();
    let firstConnected: () => void = () => {};
    const firstConnectedPromise = new Promise<void>((resolve) => {
      firstConnected = resolve;
    });

    const onMessage = (message: RunnerMessage) => {
      switch (message.type) {
        case "event":
          if (message.seq <= lastAckedSeq) break;
          lastAckedSeq = message.seq;
          emit(message.event);
          break;
        case "event_batch":
          for (const e of message.events) {
            if (e.seq <= lastAckedSeq) continue;
            lastAckedSeq = e.seq;
            emit(e.event);
          }
          break;
        case "command_result": {
          const resolve = pending.get(message.id);
          if (resolve) {
            pending.delete(message.id);
            resolve({ ok: message.ok, error: message.error });
          }
          break;
        }
        default:
          break;
      }
    };

    const acceptLoop = async (): Promise<void> => {
      if (stopped) return;
      const conn = await this.transport
        .accept(session, { lastAckedSeq, timeoutMs: this.acceptTimeoutMs })
        .catch(() => null);
      if (stopped) {
        conn?.close().catch(() => {});
        return;
      }
      if (!conn) {
        void acceptLoop();
        return;
      }
      const offMessage = conn.onMessage(onMessage);
      const offClose = conn.onClose(() => {
        offMessage();
        offClose();
        if (current === conn) current = null;
        for (const [, resolve] of pending) resolve({ ok: false, error: "runner channel closed" });
        pending.clear();
        void acceptLoop();
      });
      current = conn;
      firstConnected();
    };

    void acceptLoop();
    // Await the runner's first registration (bounded), then serve reconnects in the background.
    await Promise.race([firstConnectedPromise, sleep(this.acceptTimeoutMs)]);

    const sendCommand = async (
      name: "prompt" | "respond" | "abort",
      payload: unknown
    ): Promise<void> => {
      const conn = current;
      if (!conn) throw new Error("runner is not connected");
      const id = `cmd-${++commandSeq}`;
      const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
        pending.set(id, resolve);
      });
      await conn.send({ type: "command", id, name, payload });
      const result = await done;
      if (!result.ok) throw new Error(result.error ?? `${name} command failed`);
    };

    const events = (): EventStream => ({
      subscribe: (handler) => {
        if (buffer) {
          const replay = buffer;
          buffer = null;
          for (const e of replay) handler(e);
        }
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    });

    return {
      events,
      prompt: (message, behavior) => sendCommand("prompt", { message, behavior }),
      respond: (requestId, value) => sendCommand("respond", { requestId, ...value }),
      abort: () => sendCommand("abort", {}),
      stop: async () => {
        stopped = true;
        this.transport.abandon(session.id);
        await current?.close().catch(() => {});
      },
    };
  }
}
