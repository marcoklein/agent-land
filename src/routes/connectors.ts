import { Router } from "express";
import { SopsService } from "../services/sops.js";
import { getConfig } from "../config.js";
import { Connector } from "../types.js";
import { readFile, writeFile, stat } from "fs/promises";
import path from "path";

const config = getConfig();

export function connectorsRouter(sops: SopsService) {
  const router = Router();

  router.get("/", async (req, res) => {
    const connectors = await loadConnectors();
    res.render("layout", { view: "connectors/list", currentPage: "connectors", connectors });
  });

  router.get("/new", async (req, res) => {
    const availableSecrets = await sops.listSecrets();
    res.render("layout", { view: "connectors/new", currentPage: "connectors", availableSecrets });
  });

  router.post("/", async (req, res) => {
    const { name, type, url, secretFile } = req.body;
    try {
      if (!name || !type || !url || !secretFile) {
        req.flash("error", "All fields are required.");
        return res.redirect("/connectors/new");
      }
      if (!await sops.secretExists(secretFile.replace(".yaml", "").replace(".yml", ""))) {
        req.flash("error", `Secret "${secretFile}" not found.`);
        return res.redirect("/connectors/new");
      }

      const connectors = await loadConnectors();
      if (connectors.some(c => c.name === name)) {
        req.flash("error", `Connector "${name}" already exists.`);
        return res.redirect("/connectors/new");
      }

      const now = new Date().toISOString();
      const connector: Connector = {
        name,
        type,
        url,
        secretFile,
        createdAt: now,
        updatedAt: now,
      };
      connectors.push(connector);
      await saveConnectors(connectors);
      req.flash("success", `Connector "${name}" created.`);
      res.redirect("/connectors");
    } catch (err: any) {
      req.flash("error", `Create failed: ${err.message}`);
      res.redirect("/connectors/new");
    }
  });

  router.post("/:name/delete", async (req, res) => {
    try {
      const connectors = await loadConnectors();
      const filtered = connectors.filter(c => c.name !== req.params.name);
      await saveConnectors(filtered);
      if (req.headers["hx-request"]) {
        res.send("");
      } else {
        req.flash("success", `Connector "${req.params.name}" deleted.`);
        res.redirect("/connectors");
      }
    } catch (err: any) {
      if (req.headers["hx-request"]) {
        res.status(500).send(`<tr><td colspan="5">Error: ${err.message}</td></tr>`);
      } else {
        req.flash("error", `Delete failed: ${err.message}`);
        res.redirect("/connectors");
      }
    }
  });

  return router;
}

async function loadConnectors(): Promise<Connector[]> {
  const connPath = path.join(config.dataDir, "connectors.json");
  try {
    await stat(connPath);
    const content = await readFile(connPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveConnectors(connectors: Connector[]): Promise<void> {
  const connPath = path.join(config.dataDir, "connectors.json");
  await writeFile(connPath, JSON.stringify(connectors, null, 2));
}
