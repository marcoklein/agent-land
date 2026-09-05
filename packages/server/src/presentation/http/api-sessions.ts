import { Router } from "express";
import { SessionService } from "../../core/session-service.js";
import type { Config } from "../../config.js";
import type { PermissionPolicy } from "../../core/types.js";
import type { SequencedEvent } from "../../core/events.js";
import { createSessionInputSchema, promptInputSchema, respondInputSchema } from "@agent-land/contracts";
import { parseInput } from "./validate.js";
import { errorMessage, sessionErrorResponse } from "./errors.js";

export function sessionsApiRouter(sessionService: SessionService, config: Config) {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const parsed = parseInput(createSessionInputSchema, req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const { connectors, mounts, permissionPolicy, model, provider } = parsed.data;
      const session = await sessionService.createSession({
        connectors,
        mounts,
        permissionPolicy: (permissionPolicy as PermissionPolicy) ?? "auto",
        model,
        provider,
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
    const parsed = parseInput(promptInputSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    try {
      await sessionService.prompt(req.params.id, parsed.data.message, parsed.data.behavior);
      res.status(202).json({ accepted: true });
    } catch (err) {
      const { status, error } = sessionErrorResponse(err);
      res.status(status).json({ error });
    }
  });

  router.post("/:id/respond", async (req, res) => {
    const parsed = parseInput(respondInputSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { requestId, value, confirmed, cancelled } = parsed.data;
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
    const liveOnly = req.query.live === "1";

    const liveBuffer: SequencedEvent[] = [];
    let replayLength = -1;
    let unsubscribe = () => {};
    if (!stoppedAtStart) {
      unsubscribe = sessionService.streamEvents(req.params.id).subscribe((e) => {
        if (res.writableEnded) {
          unsubscribe();
          return;
        }
        if (liveOnly) {
          sseWrite(JSON.stringify({ ...e.event, seq: e.seq }));
          if (e.event.type === "status" && e.event.status === "stopped") {
            finish(unsubscribe);
          }
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

    if (liveOnly) {
      if (stoppedAtStart) {
        finish(unsubscribe);
        return;
      }
      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    const snapshot = await sessionService.getSequencedEvents(req.params.id);
    replayLength = snapshot.length;
    for (const { seq, event } of snapshot) sseWrite(JSON.stringify({ ...event, seq }));

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
