---
type: Reference
title: Model Discovery
description: How model listing works across pi, provider HTTP APIs, and the launch form UX.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-07-31T00:00:00Z }
updated: { by: opencode/qwen3.8-max, at: 2026-08-30T00:00:00Z }
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
3. **CLI (`al`)** — `al models [--provider <id>]` and the interactive `al new`/`al run` wizard consume `GET /api/models`

# What pi does

Pi is a black box. It receives `--provider <id>` and `--model <id>` as CLI args and handles routing internally.

- Pi has a `--list-models` flag (since 0.82.1), but it emits a human-facing table and only lists providers with configured auth — not used for discovery.
- Pi has built-in knowledge of provider endpoints.
- Pi accepts any `--model` value — runtime error if the model doesn't exist at the provider.
- For **custom providers**, pi reads `models.json` from `/tmp/pi-config/models.json` (the `PI_CODING_AGENT_DIR`, which agent-land sets).
- For **OAuth providers**, pi reads `auth.json` from the same directory.
- Installed in `agent-image/Dockerfile`[^pi-dockerfile]: `npm install -g @earendil-works/pi-coding-agent@0.82.1`

# How agent-land discovers models

Since pi's model listing isn't machine-readable, agent-land calls provider HTTP APIs directly through `ModelCatalog` (`packages/server/src/infra/model-catalog.ts`), keyed by provider id. Static model lists from provider records are a first-class discovery mode, not just a fallback (e.g. providers without a public `/models` endpoint).

## Supported API types

| API type | Endpoint | Auth | Parsing |
|----------|----------|------|---------|
| `openai-completions` | `GET {baseUrl}/models` | Bearer `{ID}_API_KEY` | `data[].id` |
| `openai-responses` | `GET {baseUrl}/models` | Bearer `{ID}_API_KEY` | `data[].id` |
| `anthropic-messages` | `GET {baseUrl}/models` | `x-api-key` | `data[].id` |
| `google-generative-ai` | `GET {baseUrl}/models?key=...` | query param | `models[].id` |
| others | `GET {baseUrl}/models` | Bearer `{ID}_API_KEY` | `data[].id` |

Timeout: 5 seconds per call, cached 1h per provider with in-flight dedupe. Discovery falls back to the provider's static `models` array, then to an empty list. For the default provider (`opencode-go`) with no provider record, a built-in static list is returned.

See [OpenCode API](opencode-api.md) for details on the opencode endpoint.[^opencode-api]

## Secret decryption

Agent Land decrypts the SOPS secret (`secrets/provider-<id>.yaml`) to extract the API credential: `{PROVIDER_ID}_API_KEY` (the provider id upper-cased, e.g. `MISTRAL_API_KEY`).

# CLI consumption

The CLI never talks to provider APIs directly — it consumes `GET /api/models?provider=<id>`.[^cli]

- `al models [--provider <id>]` prints the catalog list (defaults to the default provider).
- `al new`/`al run` in a TTY prompt for provider and model (`gatherChoices`) when the flags are omitted, using the same catalog.
- When `--model` is given without `--provider`, the CLI probes enabled providers' catalogs to find which one serves that model.

# Key files

| File | Role |
|------|------|
| `packages/server/src/infra/model-catalog.ts` | `ModelCatalog` — per-provider discovery (HTTP `/models`, static lists), cached 1h with in-flight dedupe |
| `packages/server/src/core/provider-service.ts` | `ProviderService` — provider records + secret lifecycle |
| `packages/server/src/infra/pi-config-provisioner.ts` | Renders `models.json`/`auth.json` into the container's `/tmp/pi-config` |
| `packages/server/src/presentation/http/api-models.ts` | `GET /api/models?provider=<id>` |
| `packages/server/src/presentation/http/api-providers.ts` | `GET/POST/DELETE /api/providers`, enable/disable |
| `packages/cli/src/lib/new-wizard.ts` | Interactive provider/model/connector selection for `al new`/`al run` |
| `packages/server/src/core/session-service.ts` | `resolveAgentEnv` decrypts the provider secret into container env |
| `agent-image/Dockerfile` | Pi installation, version pin |

[^opencode-api]: OpenCode API reference
[^pi-dockerfile]: Pi agent installation
[^cli]: `packages/cli/src/agent-land.ts`
