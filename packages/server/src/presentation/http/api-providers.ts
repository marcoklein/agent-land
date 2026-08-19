import { Router } from "express";
import type { ProviderService } from "../../core/provider-service.js";
import { DuplicateProviderError } from "../../core/provider-service.js";
import { PROVIDER_CATALOG } from "../../core/provider-catalog.js";
import { errorMessage } from "./errors.js";
import type { ProviderApiType, ProviderKind } from "../../core/types.js";

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

  router.get("/catalog", async (req, res) => {
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
    void req;
  });

  router.post("/", async (req, res) => {
    const body = req.body ?? {};
    const id = typeof body.id === "string" ? body.id : "";
    const kind = typeof body.kind === "string" ? body.kind : "";

    if (id.trim().length === 0) {
      return res.status(400).json({ error: "id is required" });
    }
    if (kind !== "builtin" && kind !== "custom" && kind !== "oauth") {
      return res.status(400).json({ error: 'kind must be "builtin", "custom", or "oauth"' });
    }
    if (kind === "custom") {
      if (typeof body.baseUrl !== "string" || body.baseUrl.trim().length === 0) {
        return res.status(400).json({ error: "baseUrl is required for custom providers" });
      }
      if (typeof body.api !== "string" || body.api.trim().length === 0) {
        return res.status(400).json({ error: "api is required for custom providers" });
      }
    }

    const secretFields = toRecord(body.secretFields ?? body.fields);
    const secretContent = typeof body.secretContent === "string" ? body.secretContent : undefined;

    try {
      const provider = await providerService.create({
        id,
        kind: kind as ProviderKind,
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined,
        api: typeof body.api === "string" ? (body.api.trim() as ProviderApiType) : undefined,
        models: Array.isArray(body.models) ? body.models : undefined,
        defaultModel: typeof body.defaultModel === "string" ? body.defaultModel : undefined,
        label: typeof body.label === "string" ? body.label : undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        secretFields,
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
      await providerService.delete(req.params.id);
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  return router;
}

function toRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") out[key] = val;
  }
  return out;
}
