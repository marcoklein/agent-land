import { Router } from "express";
import { SopsService } from "../services/sops.js";
import { getConfig } from "../config.js";
import { Connector } from "../types.js";
import { readFile, writeFile, stat } from "fs/promises";
import path from "path";

const config = getConfig();

interface FieldDef {
  envVar: string;
  label: string;
  placeholder: string;
}

const CONNECTOR_FIELDS: Record<string, FieldDef[]> = {
  github: [
    { envVar: "GITHUB_TOKEN", label: "Personal Access Token", placeholder: "ghp_..." },
  ],
  jira: [
    { envVar: "JIRA_EMAIL", label: "Email", placeholder: "you@example.com" },
    { envVar: "JIRA_API_TOKEN", label: "API Token", placeholder: "..." },
  ],
  gmail: [
    { envVar: "GMAIL_CLIENT_ID", label: "Client ID", placeholder: "..." },
    { envVar: "GMAIL_CLIENT_SECRET", label: "Client Secret", placeholder: "..." },
    { envVar: "GMAIL_REFRESH_TOKEN", label: "Refresh Token", placeholder: "..." },
  ],
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildYamlFromFields(type: string, body: Record<string, string>): string {
  const fields = CONNECTOR_FIELDS[type];
  if (!fields) return body.content || "";
  return fields.map(f => `${f.envVar}: ${body[f.envVar] || ""}`).join("\n");
}

export function connectorsRouter(sops: SopsService) {
  const router = Router();

  router.get("/", async (req, res) => {
    const connectors = await loadConnectors();
    res.render("layout", { view: "connectors/list", currentPage: "connectors", connectors });
  });

  router.get("/new", async (req, res) => {
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
    const inputs = fields.map(f =>
      `<label for="${f.envVar}">${f.label}</label>
       <input type="text" id="${f.envVar}" name="${f.envVar}" placeholder="${f.placeholder}" required>`
    ).join("\n");
    res.send(`
      ${inputs}
      <small>Encrypted at rest with SOPS/Age. Decrypted only at agent launch time.</small>
    `);
  });

  router.post("/", async (req, res) => {
    const { name, type, url, content } = req.body;
    try {
      if (!name || !type || !url) {
        if (req.headers["hx-request"]) {
          res.header("HX-Redirect", "/connectors/new");
          return res.status(204).end();
        }
        req.flash("error", "Name, type, and URL are required.");
        return res.redirect("/connectors/new");
      }

      const isCustom = !CONNECTOR_FIELDS[type];
      if (isCustom && !content) {
        if (req.headers["hx-request"]) {
          res.header("HX-Redirect", "/connectors/new");
          return res.status(204).end();
        }
        req.flash("error", "Credentials are required.");
        return res.redirect("/connectors/new");
      }

      if (!isCustom) {
        const fields = CONNECTOR_FIELDS[type];
        for (const f of fields) {
          if (!req.body[f.envVar]) {
            if (req.headers["hx-request"]) {
              res.header("HX-Redirect", "/connectors/new");
              return res.status(204).end();
            }
            req.flash("error", `${f.label} is required.`);
            return res.redirect("/connectors/new");
          }
        }
      }

      const connectors = await loadConnectors();
      if (connectors.some(c => c.name === name)) {
        if (req.headers["hx-request"]) {
          res.header("HX-Redirect", "/connectors/new");
          return res.status(204).end();
        }
        req.flash("error", `Connector "${name}" already exists.`);
        return res.redirect("/connectors/new");
      }

      const yamlContent = buildYamlFromFields(type, req.body);

      const secretFile = `${slugify(name)}.yaml`;
      await sops.saveEncrypted(secretFile.replace(/\.(ya?ml)$/, ""), yamlContent);

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

      if (req.headers["hx-request"]) {
        res.header("HX-Redirect", "/connectors");
        res.status(204).end();
      } else {
        req.flash("success", `Connector "${name}" created.`);
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
      const connectors = await loadConnectors();
      const connector = connectors.find(c => c.name === req.params.name);
      const filtered = connectors.filter(c => c.name !== req.params.name);
      await saveConnectors(filtered);

      if (connector) {
        await sops.deleteSecret(connector.secretFile.replace(/\.(ya?ml)$/, "")).catch(() => {});
      }

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
