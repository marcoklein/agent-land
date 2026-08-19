import { Router } from "express";
import type { SessionService } from "../core/session-service.js";
import type { ConnectorService } from "../core/connector-service.js";

export function indexRouter(sessionService: SessionService, connectorService: ConnectorService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const sessions = await sessionService.listSessions();
    const connectors = await connectorService.list();

    res.render("layout", {
      view: "home",
      currentPage: "home",
      sessionCount: sessions.length,
      runningCount: sessions.filter((s) => s.status === "running").length,
      connectorCount: connectors.length,
      recentSessions: sessions.slice(0, 5),
    });
  });

  return router;
}
