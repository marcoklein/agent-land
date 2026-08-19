import { Router } from "express";
import type { SessionService } from "../core/session-service.js";
import type { ConnectorService } from "../core/connector-service.js";
import type { ProviderService } from "../core/provider-service.js";
import type { ModelCatalog } from "../infra/model-catalog.js";
import { DEFAULT_PROVIDER_ID } from "../core/types.js";
import { buildPrompt } from "../core/prompt.js";
import { renderSessionEvent, renderSessionEventFull, escapeHtml } from "../presentation/http/log-renderer.js";
import type { SessionEvent, SequencedEvent } from "../core/events.js";

export function agentsRouter(
  sessionService: SessionService,
  connectorService: ConnectorService,
  providerService: ProviderService,
  modelCatalog: ModelCatalog
) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const sessions = await sessionService.listSessions();
    res.render("layout", { view: "agents/list", currentPage: "agents", sessions });
  });

  router.get("/new", async (_req, res) => {
    const connectors = await connectorService.list();
    const providers = await providerService.listEnabled().catch(() => []);

    const selected =
      providers.find((p) => p.id === DEFAULT_PROVIDER_ID) ?? providers[0] ?? null;
    const selectedProviderId = selected?.id ?? DEFAULT_PROVIDER_ID;
    const models = await modelCatalog.getModels(selectedProviderId).catch(() => [] as string[]);

    res.render("layout", {
      view: "agents/new",
      currentPage: "new-agent",
      connectors,
      providers,
      models,
      selectedProviderId,
    });
  });

  router.get("/model-options", async (req, res) => {
    const providerId =
      typeof req.query.provider === "string" && req.query.provider.trim().length > 0
        ? req.query.provider.trim()
        : DEFAULT_PROVIDER_ID;
    const models = await modelCatalog.getModels(providerId).catch(() => [] as string[]);

    const options = models
      .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
      .join("\n");
    res.send(
      `<select id="model" name="model">\n${options}</select>`
    );
  });

  router.post("/run", async (req, res) => {
    const { connectors, model, permissionPolicy, repoUrl, ref, provider } = req.body;
    const task: string = typeof req.body.task === "string" ? req.body.task : "";
    const connectorList: string[] = Array.isArray(connectors)
      ? connectors
      : connectors
        ? [connectors]
        : [];
    const workspace =
      typeof repoUrl === "string" && repoUrl.trim()
        ? {
            repoUrl: repoUrl.trim(),
            ref: typeof ref === "string" && ref.trim() ? ref.trim() : undefined,
          }
        : undefined;

    const isHtmx = !!req.headers["hx-request"];

    try {
      const allConnectors = await connectorService.list();
      const selected = allConnectors.filter((c) => connectorList.includes(c.name));

      const session = await sessionService.createSession({
        connectors: connectorList,
        permissionPolicy: permissionPolicy === "manual" ? "manual" : "auto",
        model,
        provider: typeof provider === "string" && provider.trim() ? provider : undefined,
        workspace,
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

    const events = await sessionService.getEvents(session.id);
    const renderedLogs = renderHistory(events, session.id);

    const viewData = {
      session,
      renderedLogs,
      totalEventCount: events.length,
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

    const afterRaw = req.query.after;
    const afterIndex =
      typeof afterRaw === "string" && Number.isFinite(Number(afterRaw)) ? Number(afterRaw) : 0;

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

    let replaying = true;
    let lastSeq = -1;
    let cursor = 0;
    const liveBuffer: SequencedEvent[] = [];
    let unsubscribe = () => {};

    if (session.status !== "stopped") {
      unsubscribe = sessionService.streamEvents(id).subscribe((e) => {
        if (res.writableEnded) {
          unsubscribe();
          return;
        }
        if (replaying) {
          liveBuffer.push(e);
          return;
        }
        render(e.event, cursor++);
        if (e.event.type === "status" && e.event.status === "stopped") {
          res.write(`event: agent-done\ndata: {"status":"stopped"}\n\n`);
          unsubscribe();
          res.end();
        }
      });
    }

    const snapshot = await sessionService.getSequencedEvents(id);
    replaying = false;
    cursor = snapshot.length;
    for (let i = afterIndex; i < snapshot.length; i++) {
      render(snapshot[i].event, i);
      lastSeq = snapshot[i].seq;
    }

    if (session.status === "stopped") {
      res.write(`event: agent-done\ndata: {"status":"stopped"}\n\n`);
      res.end();
      return;
    }

    for (const e of liveBuffer) {
      if (e.seq <= lastSeq) continue;
      render(e.event, cursor++);
    }
    liveBuffer.length = 0;

    req.on("close", unsubscribe);
  });

  router.get("/:id/event/:index", async (req, res) => {
    const id = req.params.id;
    const session = await sessionService.getSession(id);
    if (!session) return res.status(404).send("Session not found");

    const index = parseInt(req.params.index, 10);
    const history = await sessionService.getEvents(id);
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

  router.post("/:id/respond", async (req, res) => {
    const session = await sessionService.getSession(req.params.id);
    if (!session) {
      req.flash("error", "Session not found.");
      return res.redirect("/agents");
    }
    const { requestId, action, value } = req.body ?? {};
    const isHtmx = !!req.headers["hx-request"];

    if (typeof requestId !== "string" || !requestId) {
      req.flash("error", "Missing request id.");
      return res.redirect(`/agents/${session.id}`);
    }

    let respondValue: { value?: string; confirmed?: boolean; cancelled?: boolean };
    if (action === "confirm") respondValue = { confirmed: true };
    else if (action === "cancel") respondValue = { cancelled: true };
    else respondValue = { value: typeof value === "string" ? value : "" };

    try {
      await sessionService.respond(session.id, requestId, respondValue);
    } catch (err: any) {
      req.flash("error", `Respond failed: ${err.message}`);
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

function renderHistory(events: SessionEvent[], sessionId: string): string[] {
  const rendered: string[] = [];
  let turnCount = 0;
  for (let i = 0; i < events.length; i++) {
    const result = renderSessionEvent(events[i], turnCount, { entryIndex: i, sessionId });
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
      return "pico-color-red-100";
    default:
      return "pico-color-red-100";
  }
}
