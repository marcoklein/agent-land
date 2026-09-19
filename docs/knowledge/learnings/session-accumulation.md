---
type: Reference
title: Idle sessions accumulate and overload the host
description: Nothing stops an idle agent session, so 161 containers built up, drove load to ~795, and stalled deploys into 502s.
status: draft
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-19T18:14:45Z }
sources:
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: SessionService.remove leaves the workspace volume
  - id: cli-run
    resource: packages/cli/src/agent-land.ts
    title: al run keeps its session unless --rm
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

Remedy (ticketed `alt-xqav`): pass `--rm` in the loop, reap sessions idle past a TTL, cap
live sessions, and make `remove()` also delete the volume.

[^session-service]: `packages/server/src/core/session-service.ts`, `remove()`
[^cli-run]: `packages/cli/src/agent-land.ts`, `al run` "session is kept unless --rm"
