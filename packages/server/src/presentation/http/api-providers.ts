import { Router } from "express";
import type { ProviderService } from "../../core/provider-service.js";
import { DuplicateProviderError } from "../../core/provider-service.js";
import { PROVIDER_CATALOG } from "../../core/provider-catalog.js";
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

  router.get("/catalog", async (_req, res) => {
    const stored = await providerService.list().catch(() => []);
    const storedIds = new Set(stored.map((p) => p.id));
    const available = PROVIDER_CATALOG.filter((entry) => !storedIds.has(entry.id)).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      authEnvVars: entry.authEnvVars ?? null,
      defaultModel: entry.defaultModel ?? null,
    }));
    res.json({ catalog: available });
  });

  router.post("/", async (req, res) => {
    const parsed = parseInput(createProviderInputSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { id, kind, baseUrl, api, models, defaultModel, label, enabled, secretFields, fields, secretContent } =
      parsed.data;

    try {
      const provider = await providerService.create({
        id,
        kind,
        baseUrl,
        api,
        models,
        defaultModel,
        label,
        enabled,
        secretFields: secretFields ?? fields,
        secretContent,
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
