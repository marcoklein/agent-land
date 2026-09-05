---
type: Reference
title: Mount operations — durable-checkout discipline
description: How mounts behave live — auto-created writable target, persistence across sessions, the single-writer guard in anger — and the sync rule every mounted run must follow.
status: draft
generated: { by: opencode/qwen3.8-max, at: 2026-09-05T12:45:00Z }
sources:
  - id: design
    resource: /product/designs/mount-design.md
    title: Mount design
  - id: self-deploy
    resource: /learnings/self-deploy-hazard.md
    title: Self-deploy hazard
---

# Mount operations

First live use: 2026-09-05, mount `agent-land` bound at `/data` across three sessions.[^design]

- **Binding auto-creates the target.** An empty mount arrives as an empty, writable, root-owned directory. No init step — clone straight into it (`/data/agent-land`).
- **Persistence verified.** A clone survived session deletion and rebinding at the identical commit — the second session needed no re-clone.
- **Single-writer guard in anger.** A second live session asking for the same mount got the designed 409 ("bound by a live session"). An idle-but-alive session still holds the mount — `al rm <session-id>` frees it. So does a *recovered* session ([self-deploy hazard](/learnings/self-deploy-hazard.md)).
- **The sync rule.** A durable checkout is *a cache of main, not a source of truth*. Every mounted run starts with `git fetch origin && git checkout main && git reset --hard origin/main` — otherwise the agent builds on yesterday's base, the exact failure mode the primitive trades re-cloning for. The dev-playbook skill carries this step.

[^design]: [Mount design](/product/designs/mount-design.md) — invariants and rationale
