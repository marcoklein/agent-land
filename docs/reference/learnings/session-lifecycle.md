---
type: Reference
title: Session lifecycle & redeploy resilience
description: What survives an orchestrator redeploy, and how sessions recover.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-08-19T00:00:00Z }
sources:
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: SessionService state machine + event log
  - id: events
    resource: packages/server/src/core/events.ts
    title: SessionEvent types + sequence stamping
  - id: recovery-test
    resource: packages/server/src/__tests__/session-recovery.test.ts
    title: Session recovery tests
---

# Working rule

**The host owns the session; the web process only attaches to it.** Everything that must survive a redeploy lives in Docker objects and files outside the web container; the web process is a disposable view that can be rebuilt.[^recovery-test]

# Persistence matrix

| Layer | Survives redeploy? | Why |
|-------|--------------------|-----|
| Agent container `agent-land-pi-<id>` | Yes | Sibling on host daemon; Dokku never manages it |
| pi RPC process | No (exits) | stdio is an exec stream owned by the dying web process |
| pi transcript `/sessions/<id>/*.jsonl` | Yes | Shared named volume `agent-land-sessions` |
| Working directory volume `agent-land-ws-<id>` | Yes | Per-session named volume, kept on `kill()` |
| `AgentSession` JSON record | Yes | Dokku storage mount `/app/data` |
| Harness handle (prompt/respond/abort) | No | `SessionService.handles` is in-memory |
| Event history | No | In-memory ring buffer (capped at `HISTORY_CAP`), replayed from disk |
| Status accuracy | No | Stale; nothing emits events anymore |

# Recovery across a deploy

Three mechanisms cooperate: **durable event log → drain on SIGTERM → re-attach on boot**.[^session-service]

1. **Durable event log (always on)** — every event appends to `data/sessions/<id>.events.jsonl`, capped at `HISTORY_CAP` (10 000), serialized per session id so concurrent events can't interleave. Replayed on boot and on SSE reconnect.
2. **Drain on SIGTERM** — for each live session: send `abort`, wait for settle (bounded ~4s), then close the exec streams. A `draining` flag makes `SessionService` ignore the resulting close→`stopped` events. Finishes well inside Dokku's 30s grace.
3. **Re-attach on boot** — `recover()` re-runs the identical harness preset if the container still exists (see [pi rpc](pi-rpc.md)), replays the event log, sets status `idle`, clears a stale `waitingFor`. Missing container ⇒ session is genuinely dead, marked `stopped`.

# Ground-truth rule

Container presence is the single re-attach criterion — **not** the persisted status. Any status written before the process died is a guess; the container is ground truth.

[^session-service]: `packages/server/src/core/session-service.ts`
[^events]: `packages/server/src/core/events.ts`
[^recovery-test]: `packages/server/src/__tests__/session-recovery.test.ts`
