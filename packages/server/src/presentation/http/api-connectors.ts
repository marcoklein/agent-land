import { Router } from "express";
import type { ConnectorService } from "../../core/connector-service.js";
import { DuplicateConnectorError } from "../../core/connector-service.js";
import { createConnectorInputSchema } from "@agent-land/contracts";
import { parseInput } from "./validate.js";
import { errorMessage } from "./errors.js";

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

  router.post("/", async (req, res) => {
    const parsed = parseInput(createConnectorInputSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { name, url, env, content } = parsed.data;

    if (!content && (!env || Object.keys(env).length === 0)) {
      return res.status(400).json({ error: "env or content is required" });
    }

    try {
      const connector = await connectorService.create({ name, url, env, content });
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