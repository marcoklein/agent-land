import { Router } from "express";
import { SessionService, SessionNotFoundError, SessionStoppedError } from "../../core/session-service.js";
import type { PermissionPolicy, WorkspaceSpec } from "../../core/types.js";

export function sessionsApiRouter(sessionService: SessionService) {
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
    const { message } = req.body ?? {};
    if (typeof message !== "string" || message.length === 0) {
      return res.status(400).json({ error: "message is required" });
    }
    try {
      await sessionService.prompt(req.params.id, message);
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
      await sessionService.kill(req.params.id);
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
    });

    const sseWrite = (data: string) => {
      res.write(`data: ${data.replace(/\n/g, "\ndata: ")}\n\n`);
    };

    const history = await sessionService.getEvents(req.params.id);
    for (const e of history) sseWrite(JSON.stringify(e));

    if (session.status === "stopped") {
      res.write(`event: agent-done\ndata: {"status":"stopped"}\n\n`);
      res.end();
      return;
    }

    const unsubscribe = sessionService.streamEvents(req.params.id).subscribe((e) => {
      if (res.writableEnded) {
        unsubscribe();
        return;
      }
      sseWrite(JSON.stringify(e));
      if (e.type === "status" && e.status === "stopped") {
        res.write(`event: agent-done\ndata: {"status":"stopped"}\n\n`);
        unsubscribe();
        res.end();
      }
    });

    req.on("close", unsubscribe);
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
