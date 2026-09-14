import { Router, type Request, type Response } from "express";
import type { EngineApi } from "../engine-api.js";
import { timeAgo } from "../helpers.js";

type RenderView = (res: Response, view: string, data: Record<string, unknown>) => Promise<void>;

export function createResourcesRouter(engine: EngineApi, _config: unknown, renderView: RenderView) {
  const router = Router();

  router.get("/connectors", async (_req: Request, res: Response) => {
    try {
      const envelope = await engine.listConnectors() as any;
      return renderView(res, "connectors", { connectors: envelope?.connectors ?? [], timeAgo });
    } catch (err) {
      return renderView(res, "connectors", {
        connectors: [],
        error: (err as Error).message,
        timeAgo,
      });
    }
  });

  router.get("/providers", async (_req: Request, res: Response) => {
    try {
      const envelope = await engine.listProviders() as any;
      return renderView(res, "providers", { providers: envelope?.providers ?? [] });
    } catch (err) {
      return renderView(res, "providers", {
        providers: [],
        error: (err as Error).message,
      });
    }
  });

  router.get("/mounts", async (_req: Request, res: Response) => {
    try {
      const envelope = await engine.listMounts() as any;
      return renderView(res, "mounts", { mounts: envelope?.mounts ?? [] });
    } catch (err) {
      return renderView(res, "mounts", {
        mounts: [],
        error: (err as Error).message,
      });
    }
  });

  return router;
}