import { Router } from "express";
import type { ModelCatalog } from "../../infra/model-catalog.js";
import { DEFAULT_PROVIDER_ID } from "../../core/types.js";

export function modelsApiRouter(modelCatalog: ModelCatalog) {
  const router = Router();

  router.get("/", async (req, res) => {
    const rawProvider = req.query.provider;
    const providerId =
      typeof rawProvider === "string" && rawProvider.trim().length > 0
        ? rawProvider.trim()
        : DEFAULT_PROVIDER_ID;
    const models = await modelCatalog.getModels(providerId);
    res.json({ models });
  });

  return router;
}
