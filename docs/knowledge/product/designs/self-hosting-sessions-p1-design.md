---
type: Design
title: Self-hosting sessions P1 — a replaceable session runtime
description: Let the agent container own pi's input/output, so deploying agent-land no longer kills a running session.
status: draft
tags: [engine, session, runner, harness, self-hosting]
generated: { by: opencode-go/deepseek-v4.1-flash, at: 2026-09-19T15:46:09Z }
sources:
  - id: parent
    resource: /product/designs/self-hosting-sessions-design.md
    title: Self-hosting sessions (parent design, stable)
  - id: harness
    resource: packages/server/src/core/harness.ts
    title: AgentHarness port
  - id: docker
    resource: packages/server/src/infra/docker.ts
    title: DockerService — create + exec
---

# Self-hosting sessions P1 — a replaceable session runtime

## Problem

**We cannot deploy agent-land while agent-land is developing itself.**

Every merge to `main` redeploys the platform. The agent containers survive — they are
siblings on the host Docker daemon — but the platform process owns pi's `docker exec`
input/output stream. When the platform restarts, that stream closes and **pi exits
mid-turn**: the in-flight turn and the client connection are lost. `recover()` re-attaches
the conversation, but that turn's work is gone.

So every merge kills whatever the self-hosting loop is working on — as it did to the loop's
own refinement agent during the last deploy wave.

## Decision requested

Approve P1 as the first slice of the [parent design](/product/designs/self-hosting-sessions-design.md):
**make the session runtime replaceable, change no default.** It resolves the parent's three
open decisions:

1. **Transport — the runner dials out** to the control plane (SSE downstream, JSON POST
   upstream) on an engine-internal path. *Rejected:* the control plane dials into the
   container (needs the container's address and a re-dial per restart — the exact failure).
2. **Delivery — the runner is the container entrypoint**, opt-in via `SESSION_RUNTIME`
   (default stays `exec`). *Rejected:* a sidecar container (a second lifecycle for no gain).
3. **Event log — the runner owns the sequence and replay spool**; the control plane keeps
   the durable observation log. *Rejected:* the control plane owns the spool (the runner
   would re-derive state from the process we are trying to make disposable).

P1 does not end the interruption by itself; it makes the runtime replaceable so P2–P4 can
land on it. **It is a no-op in production unless `SESSION_RUNTIME=runner`.**

## Approach

Make the session runtime replaceable by moving the one non-disposable thing — pi's stdio —
out of the disposable platform process and into the agent container:

- A small **runner** in the container owns pi's stdin/stdout and translates pi-RPC into the
  existing `SessionEvent` vocabulary.
- **`RemoteAgentHarness`** is a second implementation of the existing `AgentHarness` port
  and talks to that runner.
- The runner **dials out** and reconnects on its own, so a platform restart is invisible to
  a running session.

`PiRpcHarness` (today's exec harness) stays the default; both implementations run in
parallel.

### Channel

Runner → platform: `POST /engine/runner/:sessionId/messages`. Platform → runner:
`GET /engine/runner/:sessionId/stream` (SSE). Auth is the existing per-session credential
`session-<id>:<token>`. Engine-internal: **not** under `/api`, not in the public route
table, no new primitive or identity — it reuses the platform's own SSE-downstream /
POST-upstream client pattern.

The runner assigns a monotonic `seq` per event and waits for the platform to acknowledge a
durable append before advancing. On reconnect it replays from the last acked seq, so
delivery is at-least-once and converges.

### Interfaces

- `AgentHarness` — **unchanged**; `RemoteAgentHarness` is a second implementation.
- **Runner delivery** — when `SESSION_RUNTIME=runner`, the container entrypoint is the
  runner; otherwise the current `sleep` + `docker exec` path is byte-for-byte unchanged. The
  chosen runtime is stored on the session so `recover()` picks the same implementation.
- A new `RunnerTransport` port keeps the harness testable without HTTP; production binds an
  SSE + POST implementation.

## Rollover

| Change | Effect on a running session |
|---|---|
| `packages/**` merge (control plane) | none — runner keeps pi alive |
| `agent-image/**` merge | none for running sessions; new sessions get the new runner |
| Runner / pi crash | resume (unchanged `recover()` behaviour) |
| Host restart | session dies — out of scope |

## Risks

- **Backpressure / ordering** — sends are serialized and awaited against the durable ack,
  with seq dedupe; pinned by the fake-transport test.
- **Control-plane restart mid-stream** — the runner reconnects and replays; the observation
  log is the durable projection.
- **Container hardening** — the runner is plain Node over outbound HTTP under
  `no-new-privileges`; verified in the integration test.
- **Runner crash while pi runs** — out of scope for P1 (interruption is not yet guaranteed);
  P2 reconciles.

## Change set

New: `runner-protocol`, `RunnerTransport`, `RemoteAgentHarness` and tests in
`packages/server`, plus the runner program under `agent-image/runner/`. Modified: session
types/config/docker/service (add `runtime`, select the implementation),
`agent-image/Dockerfile`.

On merge, **ADR 020** records the three decisions and two amendments: the control plane and
session runtime now have **separate lifecycles**, and the runner is harness plumbing (like
`entrypoint.sh`), not vendored technology.
