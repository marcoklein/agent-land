---
status: deprecated
date: 2026-07-31
tags: [ui, htmx, sse]
deciders: [marcoklein]
---

# Real-Time Agent UI with HTMX v4 SSE

> Superseded by [016 — Strip Web UI and Vendor Knowledge](016-strip-web-ui-and-vendor-knowledge.md). The SSE transport itself survives (see [014](014-json-api-canonical-machine-interface.md)). Retained for decision history.

**Decision:** The agent detail page uses three mechanisms: SSE for streaming logs, htmx polling for incremental stats, and a full card refresh on agent completion. The server is always authoritative; the client re-renders state.

**Why:** SSE is optimal for real-time log streaming; polling handles stats in disconnected elements; the completion-triggered card refresh synchronizes final state atomically. In htmx v4, SSE uses separate namespaced attributes (`hx-sse:connect`, `hx-sse:close`) and named events are dispatched as DOM events — a syntax migration from ADR 007.

**Alternatives considered:** Pure polling — rejected (loses the real-time stream and the completion signal). OOB swaps with `hx-swap-oob` — rejected (SSE endpoint couples to DOM element IDs). Multiple per-element triggers — rejected (too many partials).