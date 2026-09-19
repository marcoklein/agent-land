---
type: Reference
title: Idle sessions accumulate and overload the host
description: Nothing stopped idle agent sessions, so 161 containers built up, drove load to ~795, and stalled deploys into 502s. Fixed by --rm in the loop plus a control-plane reaper and cap.
status: draft
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-19T18:14:45Z }
sources:
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: SessionService.remove leaves the workspace volume
  - id: cli-run
    resource: packages/cli/src/agent-land.ts
    title: al run keeps its session unless --rm
  - id: session-reaper
    resource: packages/server/src/core/session-service.ts
    title: reapIdleSessions enforces the TTL and cap
---

# Idle sessions accumulate and overload the host

On 2026-09-19 the host (8 cores, 23 GB) hit load average ~795: 161 `agent-land-pi-*`
containers had accumulated, every one `idle`. Deploys stalled, the app returned 502, and
SSH became intermittent. The fix was a bulk `docker rm -f` of the idle containers.

Three compounding causes:

1. `al run` keeps its session after settle; the loop invokes it without `--rm`, so every
   step mints a container that is never stopped.[^cli-run]
2. The control plane has no idle reaper and no session cap, so nothing bounds the count.
3. `SessionService.remove()` deletes the record and event log but leaves the workspace
   volume (`agent-land-ws-<id>`), so even deleted sessions orphan volumes — 195 volumes for
   161 sessions.[^session-service]

Remedy (ticketed `alt-xqav`, shipped):

1. `scripts/loop.sh` now passes `--rm` to `al run`, so one-shot sessions self-delete on
   settle.[^cli-run]
2. `SessionService.reapIdleSessions()` runs on an interval and reaps sessions whose last
   update is past `SESSION_REAP_TTL_MS` (default 6 h) — container, record, and volume — and
   stops the oldest idle sessions when live sessions exceed `SESSION_MAX_LIVE` (default
   100).[^session-reaper] The interval is `SESSION_REAP_INTERVAL_MS` (default 60 s).
3. `SessionService.remove()` now deletes the workspace volume alongside the record and
   event log, so deleted sessions no longer orphan `agent-land-ws-<id>` volumes.[^session-service]

[^session-service]: `packages/server/src/core/session-service.ts`, `remove()`
[^cli-run]: `packages/cli/src/agent-land.ts`, `al run` "session is kept unless --rm"
[^session-reaper]: `packages/server/src/core/session-service.ts`, `reapIdleSessions()`
