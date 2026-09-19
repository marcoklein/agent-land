import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentSession } from "../core/types.js";
import type { RunnerConnection, RunnerTransport } from "../core/runner-transport.js";
import type { RunnerMessage } from "../core/runner-protocol.js";
import { encodeRunnerMessage } from "../core/runner-protocol.js";

interface Pending {
  session: AgentSession;
  resolve: (conn: RunnerConnection) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface SseSink {
  write(message: RunnerMessage): void;
  end(): void;
}

interface ActiveConnection {
  conn: RunnerConnection;
  dispatch: (message: RunnerMessage) => void;
  notifyClose: () => void;
}

/**
 * Production `RunnerTransport`: the runner dials out over SSE (control → runner)
 * and JSON POST (runner → control) on an engine-internal path. Auth is enforced
 * by the caller mounting this router behind the session-credential middleware.
 */
export class SsePostRunnerTransport implements RunnerTransport {
  private pending = new Map<string, Pending>();
  private sinks = new Map<string, SseSink>();
  private active = new Map<string, ActiveConnection>();

  constructor(private heartbeatMs = 30_000) {}

  router(): Router {
    const router = Router();
    router.get("/:sessionId/stream", (req, res) => this.handleStream(req, res));
    router.post("/:sessionId/messages", (req, res) => this.handleMessage(req, res));
    return router;
  }

  async accept(
    session: AgentSession,
    opts: { lastAckedSeq: number; timeoutMs?: number }
  ): Promise<RunnerConnection> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    return new Promise<RunnerConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(session.id);
        reject(new Error(`runner for session ${session.id} did not register within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(session.id, { session, resolve, reject, timer });
    });
  }

  abandon(sessionId: string): void {
    const pending = this.pending.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(sessionId);
    pending.reject(new Error(`runner ${sessionId} abandoned`));
  }

  private handleStream(req: Request, res: Response): void {
    const sessionId = req.params.sessionId as string;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sink: SseSink = {
      write: (message) => {
        if (res.writableEnded) return;
        const data = encodeRunnerMessage(message);
        res.write(`data: ${data.replace(/\n/g, "\ndata: ")}\n\n`);
      },
      end: () => {
        if (!res.writableEnded) res.end();
      },
    };
    this.sinks.set(sessionId, sink);

    const heartbeat = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      res.write(": ping\n\n");
    }, this.heartbeatMs);
    heartbeat.unref?.();

    req.on("close", () => {
      clearInterval(heartbeat);
      this.sinks.delete(sessionId);
      const conn = this.active.get(sessionId);
      if (conn) {
        this.active.delete(sessionId);
        conn.notifyClose();
      }
    });
  }

  private handleMessage(req: Request, res: Response): void {
    const sessionId = req.params.sessionId as string;
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body.type !== "string") {
      res.status(400).json({ error: "invalid runner message" });
      return;
    }
    const message = body as unknown as RunnerMessage;

    if (message.type === "register") {
      const pending = this.pending.get(sessionId);
      if (!pending) {
        res.status(409).json({ error: "no accept pending for session" });
        return;
      }
      const sink = this.sinks.get(sessionId);
      if (!sink) {
        res.status(409).json({ error: "runner must open the SSE stream before registering" });
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(sessionId);
      const active = this.makeConnection(sessionId, sink);
      this.active.set(sessionId, active);
      pending.resolve(active.conn);

      const resumeFromSeq = (message.lastAckedSeq ?? 0) + 1;
      sink.write({ type: "registered", sessionId, resumeFromSeq, heartbeatIntervalMs: this.heartbeatMs });
      res.json({ ok: true });
      return;
    }

    const active = this.active.get(sessionId);
    if (!active) {
      res.status(409).json({ error: "runner not registered" });
      return;
    }

    active.dispatch(message);

    let ackSeq: number | undefined;
    if (message.type === "event") ackSeq = message.seq;
    else if (message.type === "event_batch" && message.events.length > 0) {
      ackSeq = message.events[message.events.length - 1].seq;
    }
    res.json(ackSeq !== undefined ? { ack: ackSeq } : { ok: true });
  }

  private makeConnection(sessionId: string, sink: SseSink): ActiveConnection {
    const messageHandlers = new Set<(m: RunnerMessage) => void>();
    const closeHandlers = new Set<() => void>();

    const conn: RunnerConnection = {
      send: async (message) => {
        if (!this.sinks.has(sessionId)) throw new Error("runner channel is closed");
        sink.write(message);
      },
      onMessage: (handler) => {
        messageHandlers.add(handler);
        return () => {
          messageHandlers.delete(handler);
        };
      },
      onClose: (handler) => {
        closeHandlers.add(handler);
        return () => {
          closeHandlers.delete(handler);
        };
      },
      close: async () => {
        sink.end();
      },
    };

    return {
      conn,
      dispatch: (message) => {
        for (const handler of messageHandlers) handler(message);
      },
      notifyClose: () => {
        for (const handler of closeHandlers) handler();
      },
    };
  }
}
