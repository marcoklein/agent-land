import { Router } from "express";
import type { ConnectorService } from "../../core/connector-service.js";
import { getConnectorFields, DuplicateConnectorError } from "../../core/connector-service.js";

export function connectorsApiRouter(connectorService: ConnectorService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const connectors = await connectorService.list();
      res.json({ connectors });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.get("/fields", (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : "";
    const fields = getConnectorFields(type);
    res.json({ type: fields ? type : "custom", fields: fields ?? null });
  });

  router.post("/", async (req, res) => {
    const { name, type, url, content, fields } = req.body ?? {};

    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      typeof type !== "string" ||
      type.trim().length === 0 ||
      typeof url !== "string" ||
      url.trim().length === 0
    ) {
      return res.status(400).json({ error: "name, type and url are required" });
    }

    const fieldDefs = getConnectorFields(type);
    if (fieldDefs) {
      for (const f of fieldDefs) {
        const value = fields?.[f.envVar];
        if (typeof value !== "string" || value.trim().length === 0) {
          return res.status(400).json({ error: `${f.label} is required` });
        }
      }
    } else if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "content is required for custom connector types" });
    }

    try {
      const connector = await connectorService.create({ name, type, url, content, fields });
      res.status(201).json({ connector });
    } catch (err) {
      const status = err instanceof DuplicateConnectorError ? 409 : 400;
      res.status(status).json({ error: errorMessage(err) });
    }
  });

  router.delete("/:name", async (req, res) => {
    try {
      await connectorService.delete(req.params.name);
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  return router;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
