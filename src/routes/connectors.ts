import { Router } from "express";
import type { ConnectorService } from "../core/connector-service.js";
import { CONNECTOR_FIELDS } from "../core/connector-service.js";

export function connectorsRouter(connectorService: ConnectorService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const connectors = await connectorService.list();
    res.render("layout", { view: "connectors/list", currentPage: "connectors", connectors });
  });

  router.get("/new", async (_req, res) => {
    res.render("layout", { view: "connectors/new", currentPage: "connectors" });
  });

  router.get("/fields", (req, res) => {
    const type = req.query.type as string;
    const fields = CONNECTOR_FIELDS[type];
    if (!fields) {
      return res.send(`
        <label for="content">Credentials (YAML)</label>
        <textarea id="content" name="content" rows="8" placeholder="KEY: value&#10;KEY2: value2" required></textarea>
        <small>Key-value pairs become environment variables in the agent container.</small>
      `);
    }
    const inputs = fields
      .map(
        (f) =>
          `<label for="${f.envVar}">${f.label}</label>
       <input type="text" id="${f.envVar}" name="${f.envVar}" placeholder="${f.placeholder}" required>`
      )
      .join("\n");
    res.send(`
      ${inputs}
      <small>Encrypted at rest with SOPS/Age. Decrypted only at agent launch time.</small>
    `);
  });

  router.post("/", async (req, res) => {
    const { name, type, url, content } = req.body;
    try {
      const connector = await connectorService.create({
        name,
        type,
        url,
        content,
        fields: req.body,
      });

      if (req.headers["hx-request"]) {
        res.header("HX-Redirect", "/connectors");
        res.status(204).end();
      } else {
        req.flash("success", `Connector "${connector.name}" created.`);
        res.redirect("/connectors");
      }
    } catch (err: any) {
      if (req.headers["hx-request"]) {
        res.header("HX-Redirect", "/connectors/new");
        res.status(204).end();
      } else {
        req.flash("error", `Create failed: ${err.message}`);
        res.redirect("/connectors/new");
      }
    }
  });

  router.post("/:name/delete", async (req, res) => {
    try {
      await connectorService.delete(req.params.name);

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
