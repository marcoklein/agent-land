import { Router } from "express";
import { getModels } from "../../infra/providers.js";

export function modelsApiRouter() {
  const router = Router();

  router.get("/", async (_req, res) => {
    const models = await getModels();
    res.json({ models });
  });

  return router;
}
