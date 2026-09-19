import type { AgentHarness, AgentHandle, EventStream } from "../core/harness.js";
import type { SessionEvent } from "../core/events.js";
import type { AgentSession } from "../core/types.js";
import type { RunnerConnection, RunnerTransport } from "../core/runner-transport.js";
import type { RunnerMessage } from "../core/runner-protocol.js";

/**
 * Second `AgentHarness` implementation: talks to the in-container runner over a
 * reconnectable channel instead of owning pi's `docker exec` stream. `stop()`
 * detaches the channel — it never kills pi, so a control-plane restart cannot
 * end the runner's process.
 */
export class RemoteAgentHarness implements AgentHarness {
  constructor(private transport: RunnerTransport) {}

  async start(session: AgentSession): Promise<AgentHandle> {
    const conn = await this.transport.accept(session, { lastAckedSeq: 0 });

    const handlers = new Set<(e: SessionEvent) => void>();
    let buffer: SessionEvent[] | null = [];
    const emit = (e: SessionEvent) => {
      if (buffer) {
        buffer.push(e);
        return;
      }
      for (const h of handlers) h(e);
    };

    let closed = false;
    let commandSeq = 0;
    const pending = new Map<string, (r: { ok: boolean; error?: string }) => void>();

    const onMessage = (message: RunnerMessage) => {
      switch (message.type) {
        case "event":
          emit(message.event);
          break;
        case "event_batch":
          for (const e of message.events) emit(e.event);
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

    const offMessage = conn.onMessage(onMessage);
    const offClose = conn.onClose(() => {
      if (closed) return;
      closed = true;
      emit({ type: "status", status: "stopped" });
    });

    const sendCommand = async (
      name: "prompt" | "respond" | "abort",
      payload: unknown
    ): Promise<void> => {
      if (closed) throw new Error("runner channel is closed");
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

    const handle: AgentHandle = {
      events,
      prompt: (message, behavior) => sendCommand("prompt", { message, behavior }),
      respond: (requestId, value) => sendCommand("respond", { requestId, ...value }),
      abort: () => sendCommand("abort", {}),
      stop: async () => {
        offMessage();
        offClose();
        await conn.close().catch(() => {});
      },
    };

    return handle;
  }
}
