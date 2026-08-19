import { Router } from "express";
import type { ProviderService } from "../core/provider-service.js";
import { customProviderEnvVar } from "../core/provider-service.js";
import { slugify } from "../core/connector-service.js";
import { PROVIDER_CATALOG, getCatalogEntry, type CatalogEntry } from "../core/provider-catalog.js";
import { escapeHtml } from "../presentation/http/log-renderer.js";
import type { ProviderApiType } from "../core/types.js";

const API_TYPE_LABELS: Record<ProviderApiType, string> = {
  "openai-completions": "OpenAI Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
  "google-generative-ai": "Google Generative AI",
};

export function providersRouter(providerService: ProviderService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const providers = await providerService.list();
    res.render("layout", { view: "providers/list", currentPage: "providers", providers });
  });

  router.get("/new", async (_req, res) => {
    res.render("layout", { view: "providers/new", currentPage: "providers" });
  });

  router.get("/fields", async (req, res) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : "builtin";
    res.send(renderKindFields(kind, await availableCatalog(providerService)));
  });

  router.get("/secret-fields", (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    res.send(renderBuiltinSecretFields(id));
  });

  router.post("/", async (req, res) => {
    const isHtmx = !!req.headers["hx-request"];
    try {
      const provider = await providerService.create(buildCreateInput(req.body));
      if (isHtmx) {
        res.header("HX-Redirect", "/providers");
        res.status(204).end();
      } else {
        req.flash("success", `Provider "${provider.id}" created.`);
        res.redirect("/providers");
      }
    } catch (err: any) {
      if (isHtmx) {
        res.header("HX-Redirect", "/providers/new");
        res.status(204).end();
      } else {
        req.flash("error", `Create failed: ${err.message}`);
        res.redirect("/providers/new");
      }
    }
  });

  router.post("/:id/delete", async (req, res) => {
    try {
      await providerService.delete(req.params.id);
      if (req.headers["hx-request"]) {
        res.send("");
      } else {
        req.flash("success", `Provider "${req.params.id}" deleted.`);
        res.redirect("/providers");
      }
    } catch (err: any) {
      if (req.headers["hx-request"]) {
        res.status(500).send(`<tr><td colspan="5">Error: ${err.message}</td></tr>`);
      } else {
        req.flash("error", `Delete failed: ${err.message}`);
        res.redirect("/providers");
      }
    }
  });

  router.post("/:id/toggle", async (req, res) => {
    const provider = await providerService.get(req.params.id);
    if (!provider) {
      req.flash("error", "Provider not found.");
      return res.redirect("/providers");
    }
    await providerService.setEnabled(req.params.id, !provider.enabled);
    if (req.headers["hx-request"]) {
      res.redirect("/providers");
    } else {
      res.redirect("/providers");
    }
  });

  return router;
}

function buildCreateInput(body: Record<string, unknown>) {
  const kind = typeof body.kind === "string" ? body.kind : "";
  const id = typeof body.id === "string" ? body.id : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : undefined;
  const api = typeof body.api === "string" ? (body.api as ProviderApiType) : undefined;
  const modelsRaw = typeof body.models === "string" ? body.models : "";
  const models = modelsRaw
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  const secretContent = typeof body.secretContent === "string" ? body.secretContent : undefined;

  const secretFields = collectSecretFields(body, id, kind);

  return {
    id,
    kind: kind as "builtin" | "custom" | "oauth",
    baseUrl,
    api,
    models: models.length > 0 ? models : undefined,
    secretContent,
    secretFields: Object.keys(secretFields).length > 0 ? secretFields : undefined,
  };
}

function collectSecretFields(
  body: Record<string, unknown>,
  id: string,
  kind: string
): Record<string, string> {
  const fields: Record<string, string> = {};

  if (kind === "builtin") {
    const catalog = getCatalogEntry(id);
    for (const envVar of catalog?.authEnvVars ?? []) {
      const value = body[envVar];
      if (typeof value === "string" && value.trim().length > 0) {
        fields[envVar] = value;
      }
    }
    return fields;
  }

  if (kind === "custom") {
    const apiKey = body.apiKey;
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      fields[customProviderEnvVar(slugify(id))] = apiKey;
    }
    return fields;
  }

  return fields;
}

async function availableCatalog(providerService: ProviderService): Promise<CatalogEntry[]> {
  const stored = await providerService.list();
  const storedIds = new Set(stored.map((p) => p.id));
  return PROVIDER_CATALOG.filter((entry) => !storedIds.has(entry.id));
}

function renderKindFields(kind: string, catalog: CatalogEntry[]): string {
  if (kind === "custom") {
    return customFieldsHtml();
  }
  if (kind === "oauth") {
    return oauthFieldsHtml(catalog.filter((c) => c.kind === "oauth"));
  }
  return builtinFieldsHtml(catalog.filter((c) => c.kind === "builtin"));
}

function builtinFieldsHtml(entries: CatalogEntry[]): string {
  if (entries.length === 0) {
    return `<p><small><em>All built-in providers are already configured.</em></small></p>`;
  }
  const options = entries
    .map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.label ?? e.id)}</option>`)
    .join("\n");
  const firstId = entries[0].id;
  return `
    <label for="id">Provider</label>
    <select id="id" name="id" required
            hx-get="/providers/secret-fields"
            hx-target="#secret-fields"
            hx-trigger="change, load"
            hx-include="this"
            hx-swap="innerHTML">
      ${options}
    </select>
    <div id="secret-fields">
      ${renderBuiltinSecretFields(firstId)}
    </div>
    <small>Credentials are encrypted at rest with SOPS/Age and decrypted only at agent launch time.</small>
  `;
}

function renderBuiltinSecretFields(id: string): string {
  const catalog = getCatalogEntry(id);
  if (!catalog) return "";
  return (catalog.authEnvVars ?? [])
    .map((envVar) => {
      const isUrl = envVar.endsWith("_URL");
      return `
    <label for="${envVar}">${escapeHtml(envVar)}</label>
    <input type="${isUrl ? "text" : "password"}" id="${envVar}" name="${envVar}"
           placeholder="${escapeHtml(envVar)}" ${isUrl ? "" : "required"}>
    `;
    })
    .join("\n");
}

function customFieldsHtml(): string {
  const apiOptions = (Object.keys(API_TYPE_LABELS) as ProviderApiType[])
    .map((api) => `<option value="${api}">${API_TYPE_LABELS[api]}</option>`)
    .join("\n");
  return `
    <label for="id">Provider id</label>
    <input type="text" id="id" name="id" placeholder="e.g. my-ollama" required>

    <label for="baseUrl">Base URL</label>
    <input type="text" id="baseUrl" name="baseUrl"
           placeholder="e.g. https://token-plan.../apps/anthropic" required>
    <small>For OpenAI-style APIs include <code>/v1</code>; for Anthropic-style APIs omit it.</small>

    <label for="api">API type</label>
    <select id="api" name="api" required>
      ${apiOptions}
    </select>

    <label for="models">Models <small>(comma-separated, optional — discovery tries the /models endpoint first)</small></label>
    <input type="text" id="models" name="models" placeholder="qwen3.8-max,deepseek-v4-pro">

    <label for="apiKey">API Key</label>
    <input type="password" id="apiKey" name="apiKey" placeholder="sk-...">
    <small>Encrypted at rest with SOPS/Age. Injected into the container as an environment variable.</small>
  `;
}

function oauthFieldsHtml(entries: CatalogEntry[]): string {
  const options = entries
    .map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.label ?? e.id)}</option>`)
    .join("\n");
  return `
    <label for="id">Provider</label>
    <select id="id" name="id" required>
      ${options}
    </select>

    <label for="secretContent">OAuth tokens (YAML)</label>
    <textarea id="secretContent" name="secretContent" rows="6"
              placeholder="access: gho_...&#10;refresh: ghu_...&#10;expires: 1750000000000"></textarea>
    <small><code>access</code> is the short-lived API token, <code>refresh</code> the long-lived OAuth token. Pi re-mints <code>access</code> from <code>refresh</code> automatically.</small>
  `;
}
