import { Router } from "express";
import type { MountService } from "../../core/mount-service.js";
import {
  DuplicateMountError,
  MountNotFoundError,
  MountInUseError,
} from "../../core/mount-service.js";
import { createMountInputSchema } from "@agent-land/contracts";
import { parseInput } from "./validate.js";
import { errorMessage } from "./errors.js";

export function mountsApiRouter(mountService: MountService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const mounts = await mountService.list();
      res.json({ mounts });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post("/", async (req, res) => {
    const parsed = parseInput(createMountInputSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    try {
      const mount = await mountService.create(parsed.data.name);
      res.status(201).json({ mount });
    } catch (err) {
      const status = err instanceof DuplicateMountError ? 409 : 400;
      res.status(status).json({ error: errorMessage(err) });
    }
  });

  router.delete("/:name", async (req, res) => {
    try {
      await mountService.delete(req.params.name);
      res.json({ deleted: true });
    } catch (err) {
      if (err instanceof MountNotFoundError) return res.status(404).json({ error: errorMessage(err) });
      if (err instanceof MountInUseError) return res.status(409).json({ error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  return router;
}
