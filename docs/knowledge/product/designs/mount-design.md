---
type: Design
title: Mount — durable named folder
description: Design for the Mount primitive: a named Docker volume registered in the mount registry, attachable M:N at session creation, with a single-writer invariant and explicit cleanup. Answers the Mount Feature note's open questions.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
verified: { by: human:marcoklein, at: 2026-09-05T00:00:00Z }
sources:
  - id: feature
    resource: /product/features/mount.md
    title: Mount Feature note
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the purest form
  - id: docker
    resource: packages/server/src/infra/docker.ts
    title: Docker volume/container management
  - id: connector-service
    resource: packages/server/src/core/connector-service.ts
    title: Connector registry (registry pattern to mirror)
  - id: contracts
    resource: packages/contracts/src/routes.ts
    title: Canonical API surface
---

# Mount — durable named folder

The durable-storage primitive: a named folder that outlives any session, realized as a labeled Docker volume and registered like a Connector. Sessions bind mounts at chosen container paths at creation time.

## Approach

Mirror the existing Connector/Provider **registry pattern** (flat JSON + labeled Docker resource). A mount is a registry entry (`data/mounts/<name>.json`) plus a Docker volume labeled `app=agent-land`, `agent-land/mount=<name>`. Creation-time resolution, like connectors/env: the bind set is fixed when the session starts and never reconfigured live (engine invariant #2).

Session attach is via the existing `HostConfig.Binds` path in `createInteractiveContainer`[^docker], alongside the per-session workspace volume. This is env-injection's sibling for storage — no new engine concept, just a second capability resolved at `createSession`.

## Interfaces

**Registry entry** (`data/mounts/<name>.json`):

```json
{ "name": "agent-land", "createdAt": "…", "updatedAt": "…" }
```

**API** (extend `packages/contracts/src/routes.ts`):
- `POST /api/mounts` `{ name }` — create; 409 if exists.
- `GET /api/mounts` — list.
- `DELETE /api/mounts/<name>` — remove volume + entry; refuses while a live session binds it.
- `POST /api/sessions` gains `mounts: [{ source: "<name>", target: "/path" }]` — M:N attach at creation.

**CLI** (`al`): `al mounts ls | add --name <n> | rm <name>`, and `--mount <name>:<path>` (repeatable) on `al new`/`al run`.

**Service**: a new `MountService` mirroring `ConnectorService` — `list`, `create`, `delete`, plus `resolveBinds(mounts)` returning `HostConfig` bind strings, and a `bind<->session` guard.

## Risks & mitigations

- **Concurrent writers corrupting a checkout** → single-writer invariant (below) + the Archon discipline of per-run worktree/branch on the shared mount[^feature].
- **Volume leak / orphaned volumes** → mounts are only removed explicitly (`al mounts rm`); no implicit GC at this ship.
- **Content interpreted by the platform** → forbidden; bind is a dumb path mapping, content-agnostic[^engine].

## Answers to the Feature note's open questions

1. **"At most one live session per mount" — hard invariant or soft policy?** **Hard invariant, enforced by refusal.** `createSession` rejects with 409 if any requested mount is already bound by a live (non-`stopped`) session. No `--force`. Rationale: the single coherent use today (a git checkout) must never be clobbered by concurrent writers; a soft override re-introduces the conflict this primitive exists to prevent. Amend to soft+`force` only if a concrete fan-out use case emerges.
2. **Size/cleanup tooling at first ship?** **Manual only.** `al mounts rm` is the sole cleanup; no `prune`/size accounting yet. `docker system df` on the host is the escape hatch. Defer `al mounts prune` until Phase 4-style recurring maintenance demonstrates a need.

## Minimal change set

- `packages/contracts/src/routes.ts` — mount + session-mount contracts (zod).
- `packages/server/src/core/mount-service.ts` — new service.
- `packages/server/src/core/session-service.ts` — resolve binds + single-writer guard at `createSession`.
- `packages/server/src/infra/docker.ts` — accept extra binds (the volume handling already exists)[^docker].
- `packages/server/src/presentation/` — mount routes wired to the service.
- `packages/cli/src/` — `al mounts` + `--mount` flag.
- `docs/knowledge/engine.md` — flip Mount from `roadmap` to `stable` on merge.
- Tests: `mount-service.test.ts`, session-bind guard test.

## ADR pointer

Reuses ADR-004 (Connector model — registry over type enum) and ADR-008 (flat JSON). No new ADR unless the single-writer hard invariant is judged architecturally contested.

[^feature]: [Mount Feature note](/product/features/mount.md)
[^engine]: [Agent Land engine](/engine.md)
[^docker]: `packages/server/src/infra/docker.ts` — `createInteractiveContainer`, `HostConfig.Binds`
[^connector-service]: Connector registry pattern to mirror
[^contracts]: Canonical API surface
