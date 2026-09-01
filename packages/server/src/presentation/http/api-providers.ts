import { Router } from "express";
import type { ProviderService } from "../../core/provider-service.js";
import { DuplicateProviderError } from "../../core/provider-service.js";
import { errorMessage } from "./errors.js";
import { createProviderInputSchema } from "@agent-land/contracts";
import { parseInput } from "./validate.js";

export function providersApiRouter(providerService: ProviderService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const providers = await providerService.list();
      res.json({ providers });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post("/", async (req, res) => {
    const parsed = parseInput(createProviderInputSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { id, label, baseUrl, api, models, defaultModel, enabled, secretFields, fields, secretContent, apiKey } =
      parsed.data;

    try {
      const provider = await providerService.create({
        id,
        label,
        baseUrl,
        api,
        models,
        defaultModel,
        enabled,
        secretFields: secretFields ?? fields,
        secretContent,
        apiKey,
      });
      res.status(201).json({ provider });
    } catch (err) {
      const status = err instanceof DuplicateProviderError ? 409 : 400;
      res.status(status).json({ error: errorMessage(err) });
    }
  });

  router.post("/:id/enable", async (req, res) => {
    const provider = await providerService.setEnabled(req.params.id, true);
    if (!provider) return res.status(404).json({ error: `Provider "${req.params.id}" not found` });
    res.json({ provider });
  });

  router.post("/:id/disable", async (req, res) => {
    const provider = await providerService.setEnabled(req.params.id, false);
    if (!provider) return res.status(404).json({ error: `Provider "${req.params.id}" not found` });
    res.json({ provider });
  });

  router.delete("/:id", async (req, res) => {
    try {
      const deleted = await providerService.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: `Provider "${req.params.id}" not found` });
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  return router;
}