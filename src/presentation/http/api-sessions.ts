import { Router } from "express";
import { SessionService, SessionNotFoundError, SessionStoppedError } from "../../core/session-service.js";
import type { Config } from "../../config.js";
import type { PermissionPolicy, WorkspaceSpec } from "../../core/types.js";
import type { SequencedEvent } from "../../core/events.js";

export function sessionsApiRouter(sessionService: SessionService, config: Config) {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const { connectors, permissionPolicy, model, workspace } = req.body ?? {};
      const parsedWorkspace = parseWorkspace(workspace);
      if (parsedWorkspace === null) {
        return res.status(400).json({ error: "workspace must be { repoUrl: string, ref?: string }" });
      }
      const session = await sessionService.createSession({
        connectors: Array.isArray(connectors) ? connectors : undefined,
        permissionPolicy: (permissionPolicy as PermissionPolicy) ?? "auto",
        model: typeof model === "string" ? model : undefined,
        workspace: parsedWorkspace,
      });
      res.status(201).json({ session });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.get("/", async (_req, res) => {
    const sessions = await sessionService.listSessions();
    res.json({ sessions });
  });

  router.get("/:id", async (req, res) => {
    const session = await sessionService.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ session });
  });

  router.post("/:id/prompt", async (req, res) => {
    const { message, behavior } = req.body ?? {};
    if (typeof message !== "string" || message.length === 0) {
      return res.status(400).json({ error: "message is required" });
    }
    if (behavior !== undefined && behavior !== "steer" && behavior !== "followUp") {
      return res.status(400).json({ error: 'behavior must be "steer" or "followUp"' });
    }
    try {
      await sessionService.prompt(req.params.id, message, behavior);
      res.status(202).json({ accepted: true });
    } catch (err) {
      const { status, error } = sessionErrorResponse(err);
      res.status(status).json({ error });
    }
  });

  router.post("/:id/respond", async (req, res) => {
    const { requestId, value, confirmed, cancelled } = req.body ?? {};
    if (typeof requestId !== "string" || requestId.length === 0) {
      return res.status(400).json({ error: "requestId is required" });
    }
    const provided = [value !== undefined, confirmed !== undefined, cancelled !== undefined].filter(
      Boolean
    ).length;
    if (provided !== 1) {
      return res
        .status(400)
        .json({ error: "Provide exactly one of value, confirmed, or cancelled" });
    }
    try {
      await sessionService.respond(req.params.id, requestId, { value, confirmed, cancelled });
      res.json({ accepted: true });
    } catch (err) {
      const { status, error } = sessionErrorResponse(err);
      res.status(status).json({ error });
    }
  });

  router.post("/:id/abort", async (req, res) => {
    try {
      await sessionService.abort(req.params.id);
      res.json({ accepted: true });
    } catch (err) {
      const { status, error } = sessionErrorResponse(err);
      res.status(status).json({ error });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const session = await sessionService.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.status !== "stopped") {
        await sessionService.kill(req.params.id);
      }
      await sessionService.remove(req.params.id);
      res.json({ deleted: true });
    } catch (err) {
      console.error("DELETE debug:", err instanceof Error ? err.stack : err);
      const { status, error } = sessionErrorResponse(err);
      res.status(status).json({ error });
    }
  });

  router.get("/:id/events", async (req, res) => {
    const session = await sessionService.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sseWrite = (data: string) => {
      res.write(`data: ${data.replace(/\n/g, "\ndata: ")}\n\n`);
    };

    let ended = false;
    const finish = (unsubscribe: () => void) => {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.write(`event: agent-done\ndata: {"status":"stopped"}\n\n`);
      res.end();
    };

    const stoppedAtStart = session.status === "stopped";

    const liveBuffer: SequencedEvent[] = [];
    let replayLength = -1;
    let unsubscribe = () => {};
    if (!stoppedAtStart) {
      unsubscribe = sessionService.streamEvents(req.params.id).subscribe((e) => {
        if (res.writableEnded) {
          unsubscribe();
          return;
        }
        if (replayLength === -1) {
          liveBuffer.push(e);
          return;
        }
        if (e.seq < replayLength) return;
        sseWrite(JSON.stringify({ ...e.event, seq: e.seq }));
        if (e.event.type === "status" && e.event.status === "stopped") {
          finish(unsubscribe);
        }
      });
    }

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(`: ping\n\n`);
    }, config.sseHeartbeatMs);
    heartbeat.unref?.();

    const history = await sessionService.getEvents(req.params.id);
    const snapshot = history.slice();
    replayLength = snapshot.length;
    for (let i = 0; i < snapshot.length; i++) sseWrite(JSON.stringify({ ...snapshot[i], seq: i }));

    if (stoppedAtStart) {
      finish(unsubscribe);
      return;
    }

    for (const e of liveBuffer) {
      if (e.seq < replayLength) continue;
      sseWrite(JSON.stringify({ ...e.event, seq: e.seq }));
      if (e.event.type === "status" && e.event.status === "stopped") {
        finish(unsubscribe);
        return;
      }
    }
    liveBuffer.length = 0;

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}

function parseWorkspace(raw: unknown): WorkspaceSpec | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return null;
  const { repoUrl, ref } = raw as Record<string, unknown>;
  if (typeof repoUrl !== "string" || repoUrl.trim().length === 0) return null;
  if (ref !== undefined && typeof ref !== "string") return null;
  const trimmedRef = ref?.trim();
  return { repoUrl: repoUrl.trim(), ref: trimmedRef ? trimmedRef : undefined };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sessionErrorResponse(err: unknown): { status: number; error: string } {
  if (err instanceof SessionStoppedError) return { status: 409, error: err.message };
  if (err instanceof SessionNotFoundError) return { status: 404, error: err.message };
  return { status: 500, error: errorMessage(err) };
}
