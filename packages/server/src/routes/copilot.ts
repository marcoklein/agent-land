import { Router } from "express";
import type { ProviderService } from "../core/provider-service.js";
import {
  startDeviceFlow,
  pollDeviceToken,
  exchangeCopilotToken,
  buildCopilotSecretYaml,
} from "../infra/copilot-auth.js";

export function copilotRouter(providerService: ProviderService) {
  const router = Router();

  router.get("/new", async (req, res) => {
    const existing = await providerService.get("github-copilot");
    res.render("layout", {
      view: "providers/copilot/new",
      currentPage: "providers",
      existing: existing !== null,
    });
  });

  router.post("/start", async (req, res) => {
    try {
      const flow = await startDeviceFlow();
      setSession(req, "copilotDeviceCode", flow.deviceCode);
      res.render("providers/copilot/_poll", {
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
      });
    } catch (err: any) {
      res.status(500).send(`<p class="log-error">Device flow failed: ${err.message}</p>`);
    }
  });

  router.get("/poll", async (req, res) => {
    const deviceCode = getSession(req, "copilotDeviceCode");
    if (typeof deviceCode !== "string" || deviceCode.length === 0) {
      return res.send(`<p class="log-error">Device flow expired or missing. <a href="/providers/copilot/new">Start over</a></p>`);
    }

    try {
      const result = await pollDeviceToken(deviceCode);
      if (result.status === "authorized") {
        const copilot = await exchangeCopilotToken(result.accessToken);
        const yaml = buildCopilotSecretYaml(copilot, result.accessToken);

        const existing = await providerService.get("github-copilot");
        if (existing) {
          await providerService.delete("github-copilot");
        }
        await providerService.create({
          id: "github-copilot",
          kind: "oauth",
          defaultModel: "claude-haiku-4.5",
          secretContent: yaml,
        });
        clearSession(req, "copilotDeviceCode");
        res.header("HX-Redirect", "/providers");
        return res.status(204).end();
      }

      if (result.status === "expired") {
        clearSession(req, "copilotDeviceCode");
        return res.send(`<p class="log-error">Authorization expired. <a href="/providers/copilot/new">Start over</a></p>`);
      }
      if (result.status === "denied") {
        clearSession(req, "copilotDeviceCode");
        return res.send(`<p class="log-error">Authorization denied. <a href="/providers/copilot/new">Start over</a></p>`);
      }

      const delay = result.status === "slow_down" ? 8000 : 3000;
      res.render("providers/copilot/_poll-waiting", { delay });
    } catch (err: any) {
      res.send(`<p class="log-error">Copilot setup failed: ${err.message}</p>`);
    }
  });

  return router;
}

function setSession(req: any, key: string, value: unknown): void {
  req.session[key] = value;
}
function getSession(req: any, key: string): unknown {
  return req.session?.[key];
}
function clearSession(req: any, key: string): void {
  if (req.session) delete req.session[key];
}
