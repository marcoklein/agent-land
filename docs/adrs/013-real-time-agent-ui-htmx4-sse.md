---
status: accepted
date: 2026-07-31
tags: [ui, htmx, sse, real-time, architecture]
deciders: [marcoklein]
---

# Real-Time Agent UI with HTMX v4 SSE

**Decision:** The agent detail page uses three distinct mechanisms — SSE for log streaming, polling for stats, and a full card refresh on agent completion — rather than a single unified approach. The server is always authoritative; the client re-renders state rather than patching individual DOM elements.

**Why three mechanisms:** SSE is push-based and optimal for streaming logs (low latency, server tracks what's been sent). But SSE in v4 can only swap into the connected element — it cannot update duration, tokens, cost, or the kill button in other parts of the page. Polling handles incremental stats (every 2s). The card refresh on `agent-done` synchronizes final state (status, kill button removal, final stats) in one atomic swap.

**How it works:**
- `hx-sse:connect="/agents/:id/logs"` streams log lines into `#log-container` via `hx-swap="afterbegin"` (newest on top). The v4 SSE extension auto-swaps unnamed messages. Named events (like `agent-done`) are dispatched as DOM events.
- `<span id="agent-stats" hx-get="/agents/:id/stats" hx-trigger="every 2s">` polls for duration, tokens, and cost. Duration is computed from `startedAt` without persistence; tokens/cost are persisted to disk on every `message_end` event so the stats route sees current values.
- `<article hx-get="/agents/:id" hx-trigger="agent-done from:#log-container" hx-swap="outerHTML">` fetches the full card when the agent finishes. The route detects `hx-request` header and returns article-only HTML (no layout wrapper). The re-rendered card naturally shows final status, no kill button, final stats, and stopped polling — no conditional cleanup logic.

**On the SSE endpoint:** The `/agents/:id/logs` route polls the log file every 2s. It sends unnamed SSE messages for log content (auto-swapped by the extension) and a named `event: agent-done` to signal completion (closes the connection via `hx-sse:close="agent-done"` and triggers the card refresh).

**HTMX v4 SSE migration from ADR-007:** The original ADR-007 assumed the old `hx-sse="connect:... swap:... close:..."` syntax. In v4, the SSE extension uses separate namespaced attributes:
- `hx-sse:connect="<url>"` replaces `hx-sse="connect:<url>"`
- `hx-swap="afterbegin"` replaces the embedded `swap:` modifier
- `hx-sse:close="<event>"` replaces the embedded `close:` modifier
- `sse-swap` is removed — unnamed messages are auto-swapped, named events are dispatched as DOM events

**Vendoring:** `scripts/vendor-assets.sh` pins versions (`HTMX_VERSION=4.0.0-beta6`, `PICO_VERSION=2.1.1`) and downloads both minified and non-minified variants from jsDelivr. The SSE extension ships as `dist/ext/hx-sse.js` within the `htmx.org` npm package — not a separate package (unlike v2's `htmx-ext-sse`).

**Alternatives considered:** Pure polling (no SSE) — simpler but loses real-time log streaming and the `agent-done` signal. OOB swaps with `hx-swap-oob` — couples SSE endpoint to DOM element IDs. Multiple `hx-trigger` listeners on individual elements — too many routes and partials to maintain.
