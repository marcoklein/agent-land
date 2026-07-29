import { Router } from "express";
import { SopsService } from "../services/sops.js";
import { getConfig } from "../config.js";

const config = getConfig();

export function secretsRouter(sops: SopsService) {
  const router = Router();

  router.get("/", async (req, res) => {
    const secrets = await sops.listSecrets();
    res.render("layout", { view: "secrets/list", currentPage: "secrets", secrets });
  });

  router.get("/new", (req, res) => {
    res.render("layout", { view: "secrets/new", currentPage: "secrets", name: "", content: "" });
  });

  router.post("/", async (req, res) => {
    const { name, content } = req.body;

    function renderError(message: string) {
      return res.render("layout", {
        view: "secrets/new",
        currentPage: "secrets",
        name,
        content,
        error: message,
      });
    }

    try {
      if (!name || !content) {
        return renderError("Name and content are required.");
      }
      if (await sops.secretExists(name)) {
        return renderError(`Secret "${name}" already exists.`);
      }
      await sops.saveEncrypted(name, content);
      req.flash("success", `Secret "${name}" encrypted and saved.`);
      res.redirect("/secrets");
    } catch (err: any) {
      const hint = err.message.includes("unmarshal")
        ? `Encrypt failed: content is not valid YAML. Use <code>KEY: value</code> format (not <code>KEY=value</code>), one per line.`
        : `Encrypt failed: ${err.message}`;
      return renderError(hint);
    }
  });

  router.post("/:name/delete", async (req, res) => {
    try {
      await sops.deleteSecret(req.params.name);
      if (req.headers["hx-request"]) {
        res.send(""); // HTMX: remove row
      } else {
        req.flash("success", `Secret "${req.params.name}" deleted.`);
        res.redirect("/secrets");
      }
    } catch (err: any) {
      if (req.headers["hx-request"]) {
        res.status(500).send(`<tr><td colspan="5">Error: ${err.message}</td></tr>`);
      } else {
        req.flash("error", `Delete failed: ${err.message}`);
        res.redirect("/secrets");
      }
    }
  });

  return router;
}
