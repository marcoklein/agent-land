---
status: accepted
date: 2026-09-13
tags: [web-ui, htmx, architecture]
deciders: [agent]
---

# 18. Web UI as a separate consumer package

**Decision:** Build a standalone read-only web UI (`packages/web-ui`) as an independent consumer of the engine's JSON/SSE API, hosted as a second Dokku app on `agent-land-ui.host.impromat.app`; the engine stays API-only (ADR 016 stands for the engine).

**Why:** The CLI is the primary interface but a glanceable, phone-friendly dashboard fills the observability gap — sessions waiting on a human, running sessions, and resource inventory — without ever crossing the engine boundary.

**Details:**
- Stack: Express 5 (already in the monorepo), Eta templates, htmx4 + pico.css vendored locally (re-adopts ADR 007 and 012 for this package only)
- State stays server-side; the browser polls via htmx every 10 s — no SSE bridge or live log replay in v1 (ADR 013 stays deprecated)
- The last assistant message per waiting session is fetched via SSE replay + quiet-stop (the same pattern the CLI's `al status` uses) and cached in-memory by `updatedAt`
- Resource pages (connectors, providers, mounts) are read-only; no secrets are ever rendered (contracts guarantee `envKeys` are names only)
- Auth: Dokku-level nginx basic auth (same as the engine, ADR 009) + engine API calls use server-side `AGENT_LAND_BASIC_AUTH`
- Deploy: `Dockerfile.web` (no docker/sops/agent-image) + `deploy-web.yml` sharing the `dokku-deploy` concurrency group

**Alternatives considered:** Serve `/ui` from the engine container — rejected (violates the "no presentation in-core" boundary, ADR 016). Static SPA with CORS — rejected (adds credential-in-browser concerns, agent-authored content rendering stays server-side). Playwright-based E2E — rejected for v1 (the htmx wire contract is fully verifiable at the HTTP level with a fake engine + supertest; revisit for the live-SSE phase).