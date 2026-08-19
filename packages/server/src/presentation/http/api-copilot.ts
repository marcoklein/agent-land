import { Router } from "express";
import type { ProviderService } from "../../core/provider-service.js";
import { startDeviceFlow, pollDeviceToken } from "../../infra/copilot-auth.js";
import { createCopilotProvider } from "../../infra/copilot-provider.js";
import { errorMessage } from "./errors.js";

export function copilotApiRouter(providerService: ProviderService) {
  const router = Router();

  router.post("/start", async (_req, res) => {
    try {
      const flow = await startDeviceFlow();
      res.json({
        deviceCode: flow.deviceCode,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        interval: flow.interval,
        expiresIn: flow.expiresIn,
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post("/poll", async (req, res) => {
    const deviceCode = typeof req.body?.deviceCode === "string" ? req.body.deviceCode : "";
    if (!deviceCode) {
      return res.status(400).json({ error: "deviceCode is required" });
    }
    try {
      const result = await pollDeviceToken(deviceCode);
      if (result.status === "authorized") {
        const provider = await createCopilotProvider(providerService, result.accessToken);
        return res.json({ status: "authorized", provider });
      }
      if (result.status === "failed") {
        return res.json({ status: "failed", message: result.message });
      }
      return res.json({ status: result.status });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  return router;
}
