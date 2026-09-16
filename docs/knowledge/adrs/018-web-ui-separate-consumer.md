---
status: accepted
date: 2026-09-13
tags: [web-ui, architecture]
deciders: [agent]
---

# 18. Web UI as a separate consumer package

**Decision:** Build a read-only dashboard (`packages/web-ui`) on Express 5 + htmx4 + pico.css as an independent consumer of the engine's JSON/SSE API, hosted as a second Dokku app; the engine stays API-only (ADR 016). State is server-side; auth via Dokku-level nginx basic auth.

**Why:** A glanceable, phone-friendly observability dashboard — sessions waiting on the operator, running sessions, resource inventory — without the engine serving presentation.

**Alternatives considered:** Serve `/ui` from the engine — rejected (violates ADR 016). Static SPA with CORS — rejected (credential-in-browser risk, agent-authored content rendering stays server-side).