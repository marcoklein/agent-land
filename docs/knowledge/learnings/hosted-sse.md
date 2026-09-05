---
type: Reference
title: SSE over the hosted edge proxy
description: The three proxy gotchas that broke SSE for non-browser clients, and their fixes.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-08-19T00:00:00Z }
verified: { by: human:marcoklein, at: 2026-09-01T00:00:00Z }
sources:
  - id: api-sessions
    resource: packages/server/src/presentation/http/api-sessions.ts
    title: SSE route implementation
  - id: cli-ops
    resource: packages/cli/src/lib/ops.ts
    title: CLI SSE consumer (replay + dedupe)
---

The hosted platform sits behind an openresty edge proxy. Three behaviors broke the SSE stream for Node's HTTP/1.1-only client and were fixed in `api-sessions.ts`.[^api-sessions]

# 1. HTTP/1.1 response buffering

The proxy buffered responses (4k buffers, 8k busy-buffer). HTTP/2 clients (browsers, curl default) streamed fine; HTTP/1.1 clients received **0 bytes** and hung forever.

Fix: send `X-Accel-Buffering: no` on the SSE response.[^api-sessions]

# 2. Idle connections dropped

The proxy's `proxy-read-timeout 60s` closed idle streams.

Fix: an SSE heartbeat comment (`: ping`) written every ~30s keeps the connection alive; client-side reconnect remains as defense.

# 3. Replay → live gap

History was read before the live subscription started, so events in that window were lost and dedupe was impossible (no sequence numbers).

Fix: **subscribe first, then replay**, and stamp every event (replayed and live) with a per-session `seq`. The server drops live events with `seq` below the replay length; the client drops anything `seq <=` last-seen.[^cli-ops]

# Route details

- `GET /api/sessions/:id/events` — replays the full jsonl history, then streams live.
- `?live=1` — skips history replay (used by `al watch`).
- Replay is gapless because both phases share the same per-session `seq` counter.

[^api-sessions]: `packages/server/src/presentation/http/api-sessions.ts`
[^cli-ops]: `packages/cli/src/lib/ops.ts`
