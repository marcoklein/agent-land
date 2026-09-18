---
type: Feature
title: Agent image refresh
description: Fix agent-image staleness — ensureAgentImage detects when the built image no longer matches the deployed /agent-image source and refreshes it before the next session starts.
status: draft
tags: [engine, docker, deployment, dogfooding, correctness]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-18T03:14:37Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: staleness
    resource: /learnings/agent-image-staleness.md
    title: Agent image staleness on deploy
  - id: docker
    resource: packages/server/src/infra/docker.ts
    title: DockerService.ensureAgentImage
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: Session lifecycle and createSession ordering
  - id: mount-design
    resource: /product/designs/mount-design.md
    title: Mount design — single-writer invariant
---

# Agent image refresh

An operational-correctness bugfix to the existing Docker substrate, not a new engine primitive. `ensureAgentImage`[^docker] builds the agent image only when the tag is absent (`inspect()` → 404), and is called lazily from `createSession`[^session-service] against `config.agentImage` (default `agent-land-pi:latest`). The root `Dockerfile` embeds the agent-image source (`COPY agent-image/ /agent-image/`), so every deploy ships fresh skills and Dockerfile to `/agent-image` on the host — but a host that already built the `:latest` image once never rebuilds it[^staleness]. Skill changes (notably `agent-image/skills/orchestrator/SKILL.md` recipe changes) and image changes reach the deploy but never reach sessions. The fix makes `ensureAgentImage` detect when the built image no longer matches the deployed `/agent-image` source, refresh it, and ensure only sessions created after the refresh run the new image — without touching the existing session lifecycle.

## Fit

- **Boundary:** composes from the existing primitives and substrates; changes *when* the Docker substrate rebuilds the image, not *what* the engine is. No new primitive, workflow, or registry concept (engine invariant #6: everything above the primitives is composition)[^engine].
- **Vision board:** directly serves the dogfooding goal — the playbook lives in the image, so recipe changes reaching sessions is what keeps "the fraction of agent-land PRs opened by agent-land" moving.

## User stories

- As an operator, when I deploy a platform image carrying updated skills or an updated agent Dockerfile, I want the next session I create to run the updated agent image, so skill and image changes take effect without a manual `dokku config:set AGENT_IMAGE=<tag>` bump.
- As an operator, I want a running or re-attached session to keep the image it was created with, so a refresh never restarts or breaks in-flight work.
- As an operator, I want a failed refresh to have a defined outcome (fail-open to the existing image or fail-closed with a clear error), so session creation never fails silently or hangs ambiguously.

## Acceptance criteria

1. **Detection** — `ensureAgentImage` determines whether the built `agentImage` matches the deployed `/agent-image` source (or the published registry image), using a stamped hash/digest, not mere tag presence.
2. **Refresh-on-mismatch** — on mismatch, `ensureAgentImage` rebuilds (local dev) or pulls (production, if adopted) the image before `createInteractiveContainer` runs.
3. **Post-refresh sessions only** — sessions created after a successful refresh run the new image; sessions created before or during the refresh are unaffected. This aligns with the create-time-is-resolution-time invariant: env, engine config, and mount binds are fixed at session start[^engine].
4. **Unchanged session lifecycle** — `recover()` does not call `ensureAgentImage` (it already doesn't); running sessions and re-attached sessions keep their existing image. Container presence remains the ground truth for recovery.
5. **No new API surface** — the change is contained to `ensureAgentImage` plus image stamping at build time; no new route, session field, or CLI surface.

## Open questions

These are decisions for the design gate; the design note must answer each or mark it explicitly deferred.

1. **Staleness signal** — content-hash label set at `docker build` time, a stamp file written into `/agent-image`, or a registry digest comparison? Hash canonicalization (file ordering, symlinks, excluded paths) must be identical on the build side and the runtime side[^staleness].
2. **Registry pull vs. rebuild — and is a registry even real today?** No `docker push`/registry exists anywhere in the repo; production is Dokku building the root image, local dev is `docker compose up --build`. **Docker Hub registry-pull is likely out of v1** — v1 is most plausibly "rebuild from `/agent-image` with a stamp" everywhere, registry pull deferred until a publish step exists. *(Explicitly marked open; a CI build+push would add a human-managed deploy credential that stays outside agent containers.)*
3. **Prod vs. local-dev detection** — no such flag exists today (`NODE_ENV` is not read). New config env var, inference, or one uniform behavior (rebuild from `/agent-image`) that works in both because `/agent-image` is always the embedded source?
4. **Where does the stamp come from, mechanically** — build-arg/`--label` passed by the build driver (Dokku / `docker compose` / CI) vs. a committed/generated stamp file, so a deployed platform image always carries a stamp matching its embedded `/agent-image`?
5. **Latency / the slow-first-create wrinkle** — refresh currently would run on the `createSession` critical path (the first-ever build already has, causing client timeouts and orphaned sessions). Stay lazy but single-flighted and documented, or move off the critical path (eager boot-time refresh)? Constraint: "sessions created after the refresh get the updated image" must still hold.
6. **Concurrency / single-flight** — two simultaneous `createSession` calls both seeing a stale image would both rebuild/pull. In-process (or file-lock) single-flight guard needed? One web process in Dokku, but possibly multiple under `docker compose`.
7. **Tag strategy** — keep mutable `:latest` and re-point it on refresh (old containers keep the old image — satisfying "no lifecycle change"), or content-addressed tags (`agent-land-pi:<hash>`) with `AGENT_IMAGE` re-pointed?
8. **Failure semantics** — a refresh failure must not block session creation silently: fail-open to the existing image, or fail-closed with a clear error? Decide and document.
9. **Cleanup / GC** — after re-pointing `:latest`, the old image is orphaned but still referenced by live containers. Manual `docker image prune` guidance vs. automated cleanup; scope for v1?

## Notes for the design gate

- **Mount single-writer interaction:** `ensureAgentImage` runs after the mount-in-use check and before container creation[^session-service]; a slow rebuild stretches that window and can make `al run` clients time out while the server-side session succeeds (orphan). The fix must not add mount binding/unbinding, and must account for pipeline stage children that bind the `agent-land` checkout mount one at a time[^mount-design].
- **Sibling-container model:** the refresh must work through the host Docker socket (ADR 002 — socket-mounted sibling containers), not DinD.
- **On merge (suppression rule):** deprecate `/learnings/agent-image-staleness.md` (inline pointer forward), flip the "Agent image updates reach the host ❌ Gap" row in the dogfooding playbook, clean the `learnings/index.md` entry, and update §4 of `/learnings/first-loopback-run.md` (the `dokku config:set AGENT_IMAGE=agent-land-pi:0.2` tag-bump workaround becomes obsolete).

[^engine]: [Agent Land engine](/platform/engine.md) — invariants #2 (create-time is resolution-time) and #6 (everything above is composition)
[^staleness]: [Agent image staleness on deploy](/learnings/agent-image-staleness.md) — the canonical problem statement and candidate content-hash-label fix
[^docker]: `packages/server/src/infra/docker.ts` — `ensureAgentImage()`, `createInteractiveContainer()`
[^session-service]: `packages/server/src/core/session-service.ts` — `createSession()` ordering; `recover()` never calls `ensureAgentImage`
[^mount-design]: [Mount design](/product/designs/mount-design.md) — single-writer invariant, hard-enforced at `createSession`
