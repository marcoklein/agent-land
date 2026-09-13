import { Router, type Request, type Response } from "express";
import type { EngineApi } from "../engine-api.js";
import type { Config } from "../config.js";
import { getSessionStatus } from "../last-message.js";
import { linkify } from "../helpers.js";

type RenderView = (res: Response, view: string, data: Record<string, unknown>) => Promise<void>;

export function createSessionsRouter(engine: EngineApi, config: Config, renderView: RenderView) {
  const router = Router();

  function badgeClass(status: string): string {
    switch (status) {
      case "running": return "";
      case "waiting_for_input": return "pico-color-yellow-100";
      case "idle": return "pico-color-jade-100";
      case "stopped": return "pico-color-red-100";
      default: return "";
    }
  }

  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const envelope = await engine.getSession(id) as any;
      const session = envelope?.session;
      if (!session) {
        return renderView(res, "session", {
          session: null,
          badgeClass: "",
          lastMessage: null,
          error: "Session not found",
        });
      }

      let lastMessage: string | null = null;
      try {
        const result = await getSessionStatus(
          engine.eventsUrl,
          config.authHeader,
          session.id,
          { quietMs: config.quietMs }
        );
        lastMessage = linkify(result.lastMessage);
      } catch {
        lastMessage = null;
      }

      return renderView(res, "session", {
        session,
        badgeClass: badgeClass(session.status),
        lastMessage,
        error: null,
      });
    } catch (err) {
      return renderView(res, "session", {
        session: null,
        badgeClass: "",
        lastMessage: null,
        error: (err as Error).message,
      });
    }
  });

  return router;
}