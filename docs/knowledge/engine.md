---
type: Reference
title: Agent Land engine — the purest form
description: The minimal core of the agent-land platform. Six primitives, three substrates, one engine opinion. Everything else is composition.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-08-29T00:00:00Z }
sources:
  - id: architecture
    resource: /knowledge/architecture.md
    title: Architecture — the zoom ladder
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: Session lifecycle and capability injection
  - id: connector-service
    resource: packages/server/src/core/connector-service.ts
    title: Connector management
  - id: provider-service
    resource: packages/server/src/core/provider-service.ts
    title: Provider management
  - id: docker
    resource: packages/server/src/infra/docker.ts
    title: Docker container and volume management
  - id: contracts
    resource: packages/contracts/src/routes.ts
    title: Canonical API surface
---

# Agent Land engine — the purest form

Agent Land is a **session engine**. It runs long-lived coding agents in Docker containers on your server. Each session gets three capabilities, produces one observable output, and can spawn more sessions through the platform's own API.

## The six primitives

### Capabilities (injected at session creation)

1. **Connector** — named sealed env bag. Credentials encrypted at rest (SOPS/Age), decrypted in-memory at launch, injected as environment variables into the container. No type enum — fully generic. The platform never synthesizes variables.

2. **Provider** — LLM backend config. One generic record shape: `id`, `baseUrl`, `api` (dialect), `models`, `defaultModel`, and a sealed credential payload. No vendor catalog in-core — presets and device flows live in the CLI/packs.

3. **Mount** — named durable folder attached to a session container at a chosen path. Realized as a Docker volume with a label. Outlives any session. M:N attach; at most one live session per mount. Carries repo checkouts, warm caches, skill files, tooling dirs — the platform is content-agnostic. *(roadmap — not yet implemented)*

### The engine

4. **Session** — the agent process itself. One `pi --mode rpc` agent in one Docker container. Lifecycle: `idle` → `running` → `waiting_for_input` → back; `stopped` is terminal. Permission policy: `auto` (unattended) or `manual` (dialogs routed to a human). Fixed at creation — never reconfigured live.

### Observation

5. **Event Stream** — a session's sequenced, append-only record, broadcast live over SSE and persisted as the event log. The single observation channel. Vocabulary is agent-mechanical (status, turn_start, message_delta, tool_start, agent_settled, waiting_for_input, …), never business-semantic. Four consumer roles: rendering, settle detection, machine consumption, cross-session observation.

### Loopback

6. **Platform Connector** — at session creation, the engine self-injects `AGENT_LAND_URL` and `AGENT_LAND_BASIC_AUTH` as env vars. The agent becomes a first-class client of the platform: it can create child sessions, prompt them, and watch their event streams. Multi-agent composition needs no new primitives. *(roadmap — not yet implemented)*

## Substrate (three services)

| Service | Realizes |
|---|---|
| Docker | Session → container (limited, cap-dropped, no-new-privileges, socket-sibling), Mount → volume *(roadmap)* |
| SOPS/Age | Secrets at rest (Connector and Provider credentials) |
| Flat JSON | Session records, connector/provider registries, per-session event logs |

## One engine opinion

`pi --mode rpc` is the fixed agent runtime — a platform-level choice rather than a session-level knob.

## The composition layer

- **Projects** — a named mount + a recipe (connectors, provider, model, playbook). A use-case convention.
- **Workflows** — sequences of session / prompt / respond calls. Defined in prompts, scripts, or YAML recipes.
- **Schedules** — cron or triggers that call the API. External.
- **Connector packs** — field schemas and skill files for specific external systems. Live in mounts and CLI presets.
- **Provider presets** — base URLs, API dialects, default models for known vendors. Live in CLI presets.

All of these are **composition** — built from the six primitives, outside the engine.

## Deployment

Production: Dokku on a VPS. `git push dokku main:master` deploys the whole platform. Dokku auto-detects the root `Dockerfile`, builds it, provisions SSL, and places nginx with basic auth in front.

Local dev: `docker compose up --build -d` against `docker-compose.yml`.

## Invariants

1. Registries (Connector, Provider, Mount) are independent and outlive sessions.
2. Create-time is resolution-time — env, engine config, and mount binds are fixed when the session starts.
3. The platform observes, never interprets — everything it knows about agent behavior comes from the event stream.
4. No technology baked into containers — the agent image is node + pi + git + curl.
5. Every session is a platform client — self-injected auth enables multi-agent composition. *(roadmap)*
6. Everything above is composition — projects, workflows, schedules, gates build from the primitives.