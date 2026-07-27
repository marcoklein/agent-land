---
status: accepted
date: 2026-07-27
tags: [frontend, ui]
deciders: [marcoklein]
---

# HTMX 4 + Pico CSS Served Locally

**Decision:** Use HTMX 4 with SSE extension and Pico CSS, all bundled and served from the orchestrator. No CDN dependencies. No JavaScript build step.

**Why:** Classless CSS (~83KB) covers all styling needs. HTMX 4 SSE uses `fetch()` + `ReadableStream` for live log streaming without WebSockets. Serving locally avoids CDN outages and keeps the app fully self-contained.

**Alternatives considered:** React/Vue SPA, HTMX 2.x — rejected because SPA requires a build step and API layer; HTMX 2 `EventSource`-based SSE is less capable than HTMX 4's `fetch()`-based streams.
