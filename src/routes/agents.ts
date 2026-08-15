import { Router } from "express";
import type { SessionService } from "../core/session-service.js";
import type { ConnectorService } from "../core/connector-service.js";
import { buildPrompt } from "../core/prompt.js";
import { getModels } from "../infra/providers.js";
import { renderSessionEvent, renderSessionEventFull } from "../presentation/http/log-renderer.js";
import type { SessionEvent } from "../core/events.js";

export function agentsRouter(sessionService: SessionService, connectorService: ConnectorService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const sessions = await sessionService.listSessions();
    res.render("layout", { view: "agents/list", currentPage: "agents", sessions });
  });

  router.get("/new", async (_req, res) => {
    const connectors = await connectorService.list();
    const models = await getModels().catch(() => [] as string[]);
    res.render("layout", { view: "agents/new", currentPage: "new-agent", connectors, models });
  });

  router.post("/run", async (req, res) => {
    const { connectors, model, permissionPolicy } = req.body;
    const task: string = typeof req.body.task === "string" ? req.body.task : "";
    const connectorList: string[] = Array.isArray(connectors)
      ? connectors
      : connectors
        ? [connectors]
        : [];

    const isHtmx = !!req.headers["hx-request"];

    try {
      const allConnectors = await connectorService.list();
      const selected = allConnectors.filter((c) => connectorList.includes(c.name));

      const session = await sessionService.createSession({
        connectors: connectorList,
        permissionPolicy: permissionPolicy === "manual" ? "manual" : "auto",
        model,
      });

      if (task.trim()) {
        await sessionService.prompt(session.id, buildPrompt(task, selected));
      }

      if (isHtmx) {
        res.header("HX-Redirect", `/agents/${session.id}`);
        res.status(204).end();
      } else {
        res.redirect(`/agents/${session.id}`);
      }
    } catch (err: any) {
      if (isHtmx) {
        res.header("HX-Redirect", "/agents/new");
        res.status(204).end();
      } else {
        req.flash("error", `Launch failed: ${err.message}`);
        res.redirect("/agents/new");
      }
    }
  });

  router.get("/:id", async (req, res) => {
    const session = await sessionService.getSession(req.params.id);
    if (!session) {
      req.flash("error", "Session not found.");
      return res.redirect("/agents");
    }

    const renderedLogs = renderHistory(sessionService.getEvents(session.id));

    const viewData = {
      session,
      renderedLogs,
      totalEventCount: sessionService.getEvents(session.id).length,
    };

    if (req.headers["hx-request"]) {
      return res.render("agents/show", viewData);
    }

    res.render("layout", {
      ...viewData,
      view: "agents/show",
      currentPage: "agents",
    });
  });

  router.get("/:id/events", async (req, res) => {
    const id = req.params.id;
    const session = await sessionService.getSession(id);
    if (!session) return res.status(404).send("Not found");

    const afterIndex = req.query.after ? parseInt(req.query.after as string, 10) : 0;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sseWrite = (data: string) => {
      res.write(`data: ${data.replace(/\n/g, "\ndata: ")}\n\n`);
    };

    let turnCount = 0;
    const render = (event: SessionEvent, index: number) => {
      const result = renderSessionEvent(event, turnCount, { entryIndex: index, sessionId: id });
      turnCount = result.turnCount;
      if (result.html) sseWrite(result.html);
    };

    const history = sessionService.getEvents(id);
    for (let i = afterIndex; i < history.length; i++) render(history[i], i);

    if (session.status === "stopped") {
      res.write(`event: agent-done\ndata: {"status":"stopped"}\n\n`);
      res.end();
      return;
    }

    let cursor = history.length;
    const unsubscribe = sessionService.streamEvents(id).subscribe((event) => {
      if (res.writableEnded) {
        unsubscribe();
        return;
      }
      render(event, cursor++);
      if (event.type === "status" && event.status === "stopped") {
        res.write(`event: agent-done\ndata: {"status":"stopped"}\n\n`);
        unsubscribe();
        res.end();
      }
    });

    req.on("close", unsubscribe);
  });

  router.get("/:id/event/:index", async (req, res) => {
    const id = req.params.id;
    const session = await sessionService.getSession(id);
    if (!session) return res.status(404).send("Session not found");

    const index = parseInt(req.params.index, 10);
    const history = sessionService.getEvents(id);
    const event = history[index];
    if (!event) return res.status(404).send("Event not found");

    res.send(renderSessionEventFull(event) ?? "");
  });

  router.post("/:id/kill", async (req, res) => {
    const session = await sessionService.getSession(req.params.id);
    const isHtmx = !!req.headers["hx-request"];

    if (!session) {
      req.flash("error", "Session not found.");
      if (isHtmx) {
        res.header("HX-Redirect", "/agents");
        return res.status(204).end();
      }
      return res.redirect("/agents");
    }
    if (session.status === "stopped") {
      req.flash("error", "Session is not running.");
      if (isHtmx) {
        res.header("HX-Redirect", `/agents/${session.id}`);
        return res.status(204).end();
      }
      return res.redirect(`/agents/${session.id}`);
    }
    try {
      await sessionService.kill(session.id);
    } catch (err: any) {
      req.flash("error", `Kill failed: ${err.message}`);
      if (isHtmx) {
        res.header("HX-Redirect", `/agents/${session.id}`);
        return res.status(204).end();
      }
      return res.redirect(`/agents/${session.id}`);
    }
    if (isHtmx) {
      res.header("HX-Redirect", `/agents/${session.id}`);
      res.status(204).end();
    } else {
      res.redirect(`/agents/${session.id}`);
    }
  });

  router.get("/:id/status-badge", async (req, res) => {
    const session = await sessionService.getSession(req.params.id);
    if (!session) return res.send(`<mark>not found</mark>`);
    res.send(`<mark id="status-badge" class="${statusClass(session.status)}">${session.status}</mark>`);
  });

  return router;
}

function renderHistory(events: SessionEvent[]): string[] {
  const rendered: string[] = [];
  let turnCount = 0;
  for (let i = 0; i < events.length; i++) {
    const result = renderSessionEvent(events[i], turnCount, { entryIndex: i });
    turnCount = result.turnCount;
    if (result.html) rendered.push(result.html);
  }
  return rendered;
}

function statusClass(status: string): string {
  switch (status) {
    case "running":
      return "";
    case "idle":
      return "pico-color-jade-100";
    case "waiting_for_input":
      return "pico-color-yellow-100";
    case "stopped":
      return "pico-color-yellow-100";
    default:
      return "pico-color-red-100";
  }
}
