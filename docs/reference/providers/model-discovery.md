---
type: Reference
title: Model Discovery
description: How model listing works across pi, provider HTTP APIs, and the launch form UX.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-07-31T00:00:00Z }
updated: { by: opencode/deepseek-v4-pro, at: 2026-07-31T00:00:00Z }
sources:
  - id: opencode-api
    resource: /reference/providers/opencode-api.md
    title: OpenCode API reference
  - id: pi-dockerfile
    resource: agent-image/Dockerfile
    title: Pi agent installation
---

# Layers

Model discovery in agent-land spans three layers:

1. **pi agent CLI** (`@earendil-works/pi-coding-agent@0.82.1`) — Docker container, black box
2. **Provider HTTP APIs** — direct REST calls from agent-land
3. **Agent Land launch form** — `/agents/new`, server-rendered `<select>` with models from Go API

# What pi does

Pi is a black box. It receives `--provider <id>` and `--model <id>` as CLI args and handles routing internally.

- Pi has **no** `--list-models` flag or model discovery command
- Pi has built-in knowledge of provider endpoints
- Pi accepts any `--model` value — runtime error if the model doesn't exist at the provider
- For **custom providers**, pi reads `models.json` from `/pi-agent-config/models.json`
- Installed in `agent-image/Dockerfile`[^pi-dockerfile]: `npm install -g @earendil-works/pi-coding-agent@0.82.1`

# How agent-land discovers models

Since pi doesn't expose model listing, agent-land calls provider HTTP APIs directly.

## Supported API types

| API type | Endpoint | Auth | Parsing |
|----------|----------|------|---------|
| `openai-completions` | `GET {baseUrl}/models` | Bearer `api_key` | `data[].id` |
| `openai-responses` | `GET {baseUrl}/models` | Bearer `api_key` (or `access` for OAuth) | `data[].id` |
| `anthropic-messages` | `GET {baseUrl}/v1/models?limit=1000` | `x-api-key` | `data[].id` |
| `opencode` | `GET https://opencode.ai/zen/v1/models` | none (public) | `data[].id` |
| `opencode-go` | `GET https://opencode.ai/zen/go/v1/models` | none (public) | `data[].id` |
| others | — | — | returns `[]` |

See [OpenCode API](opencode-api.md) for details on the opencode endpoint.[^opencode-api]

Timeout: 5 seconds per call. All populate `ProviderModelConfig[]` with `{ id }` only.

## Secret decryption

Agent Land decrypts the SOPS secret (`secrets/provider-<id>.yaml`) to extract the API credential:

- **API key providers**: `api_key: sk-...`
- **OAuth providers**: `access: gho_...` (GitHub Copilot device flow tokens)

The opencode provider's `/zen/v1/models` endpoint is public, so no decryption is needed.

# UX approach

## Chosen: native `<select>` (server-rendered)

A standard HTML `<select>` element with `<option>` elements rendered server-side in the EJS template. Models are fetched once at page render time from `getModels()` (cached). Pico CSS styles `<select>` natively with border, padding, and focus ring.

**Why `<select>` over `<datalist>`:**

1. `<datalist>` has browser quirks — after selecting a value, browsers filter options based on the input's content, making re-selection unreliable. Pico CSS doesn't style the dropdown panel.
2. `<select>` is native HTML with guaranteed behavior across all browsers and screen readers.
3. `<select>` is automatically styled by Pico CSS.
4. Since agent-land uses a single provider (`opencode-go`) with a closed set of 23 models, there's no need for free-text model input.
5. Follows the principle: HTML fundamentals first, HTMX when needed, JavaScript only as last resort.

## Design principles

1. **HTML fundamentals first** — native `<select>` is the baseline for a list of discrete options.
2. **Server-rendered (HTMX-compatible)** — models fetched once at page load, rendered into the template. No client-side fetching needed.
3. **Avoid JavaScript** — `<select>` requires zero JS. No `onfocus` hacks, no datalist workarounds.
4. **Pico CSS native styling** — Pico handles `<select>` styling automatically (border, focus ring, dropdown). No custom CSS needed.

# Key files

| File | Role |
|------|------|
| `src/infra/providers.ts` | `getModels()` — fetches from OpenCode Go `/go/v1/models`, caches in memory (1h TTL, in-flight dedupe) |
| `src/presentation/http/api-models.ts` | `GET /api/models` — machine-readable model list |
| `src/routes/agents.ts` | `GET /new` — calls `getModels()`, passes `models` array to template |
| `src/views/agents/new.ejs` | Model `<select>` with server-rendered `<option>` elements |
| `src/infra/docker.ts` | `--provider opencode-go` + `--model <id>` passed to pi CLI |
| `src/core/session-service.ts` | Injects `OPENCODE_API_KEY`/`OPENCODE_API_URL` into container env |
| `agent-image/Dockerfile` | Pi installation, version pin

[^opencode-api]: OpenCode API reference
[^pi-dockerfile]: Pi agent installation
