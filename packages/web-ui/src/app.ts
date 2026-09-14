import express, { type Request, type Response } from "express";
import { Eta } from "eta";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { Config } from "./config.js";
import { createEngineApi } from "./engine-api.js";
import { createDashboardRouter } from "./routes/index.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createResourcesRouter } from "./routes/resources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, "..", "views");
const publicDir = join(__dirname, "..", "public");

export function createApp(config: Config) {
  const engine = createEngineApi(config);
  const eta = new Eta({ views: viewsDir, autoTrim: false });
  const app = express();

  const renderView = async (res: Response, view: string, data: Record<string, unknown>) => {
    const isHtmx = !!res.req.headers["hx-request"];
    try {
      const body = await eta.renderAsync(view, data) as string;
      if (isHtmx) {
        res.type("html").send(body);
      } else {
        const full = await eta.renderAsync("layout", { ...data, body }) as string;
        res.type("html").send(full);
      }
    } catch (err) {
      res.status(500).type("html").send(`<p>Render error: ${(err as Error).message}</p>`);
    }
  };

  app.use("/vendor", express.static(publicDir + "/vendor"));

  const { router: dashboardRouter } = createDashboardRouter(engine, config, renderView);
  const sessionsRouter = createSessionsRouter(engine, config, renderView);
  const resourcesRouter = createResourcesRouter(engine, config, renderView);

  app.use("/", dashboardRouter);
  app.use("/sessions", sessionsRouter);
  app.use("/", resourcesRouter);

  return app;
}