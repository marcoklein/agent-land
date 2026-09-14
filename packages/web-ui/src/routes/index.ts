import { Router, type Request, type Response } from "express";
import type { EngineApi } from "../engine-api.js";
import type { Config } from "../config.js";
import { getSessionStatus, createLastMessageCache } from "../last-message.js";
import { linkify, timeAgo } from "../helpers.js";

type RenderView = (res: Response, view: string, data: Record<string, unknown>) => Promise<void>;

export function createDashboardRouter(engine: EngineApi, config: Config, renderView: RenderView) {
  const router = Router();
  const lastMessageCache = createLastMessageCache();

  type SessionRow = {
    id: string;
    status: string;
    provider?: string;
    model: string;
    connectors: string[];
    updatedAt: string;
    timeAgo: string;
    waitingFor?: { method: string; prompt?: string };
    lastMessage?: string;
  };

  async function buildSessionRow(s: any): Promise<SessionRow> {
    const row: SessionRow = {
      id: s.id,
      status: s.status,
      provider: s.provider,
      model: s.model,
      connectors: s.connectors ?? [],
      updatedAt: s.updatedAt,
      timeAgo: timeAgo(s.updatedAt),
      waitingFor: s.waitingFor ?? undefined,
    };

    if (s.status === "waiting_for_input" && s.waitingFor) {
      const cached = lastMessageCache.get(s.id, s.updatedAt);
      if (cached !== null) {
        row.lastMessage = cached;
      } else {
        try {
          const result = await getSessionStatus(
            engine.eventsUrl,
            config.authHeader,
            s.id,
            { quietMs: config.quietMs }
          );
          const linked = linkify(result.lastMessage);
          lastMessageCache.set(s.id, s.updatedAt, linked);
          row.lastMessage = linked;
        } catch {
          row.lastMessage = "";
        }
      }
    }

    return row;
  }

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const [sessionsRes, connectorsRes, providersRes, mountsRes] = await Promise.all([
        engine.listSessions(),
        engine.listConnectors(),
        engine.listProviders(),
        engine.listMounts(),
      ]);

      const sessions: any[] = (sessionsRes as any)?.sessions ?? [];
      const connectors: any[] = (connectorsRes as any)?.connectors ?? [];
      const providers: any[] = (providersRes as any)?.providers ?? [];
      const mounts: any[] = (mountsRes as any)?.mounts ?? [];

      const rows = await Promise.all(sessions.map((s: any) => buildSessionRow(s)));

      return renderView(res, "dashboard", {
        waiting: rows.filter((r) => r.status === "waiting_for_input"),
        running: rows.filter((r) => r.status === "running"),
        idle: rows.filter((r) => r.status === "idle"),
        stopped: rows.filter((r) => r.status === "stopped"),
        connectorCount: connectors.length,
        providerCount: providers.length,
        mountCount: mounts.length,
        error: null,
      });
    } catch (err) {
      return renderView(res, "dashboard", {
        waiting: [],
        running: [],
        idle: [],
        stopped: [],
        connectorCount: 0,
        providerCount: 0,
        mountCount: 0,
        error: (err as Error).message,
      });
    }
  });

  return { router };
}