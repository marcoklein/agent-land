---
type: Design
title: Agent image refresh — content-hash label rebuild
description: Design for fixing agent-image staleness: ensureAgentImage stamps the built agent-land-pi image with a canonical content-hash label of /agent-image and rebuilds on mismatch, single-flighted and fail-open, without touching the session lifecycle.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-18T03:23:29Z }
sources:
  - id: feature
    resource: /product/features/agent-image-refresh.md
    title: Agent image refresh Feature note
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: docker
    resource: packages/server/src/infra/docker.ts
    title: DockerService.ensureAgentImage / createInteractiveContainer
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: createSession ordering; recover() never calls ensureAgentImage
  - id: staleness
    resource: /learnings/agent-image-staleness.md
    title: Agent image staleness on deploy
  - id: loopback
    resource: /learnings/first-loopback-run.md
    title: First loopback run — the tag-bump workaround and its wrinkles
  - id: session-lifecycle
    resource: /learnings/session-lifecycle.md
    title: Session lifecycle & redeploy resilience
  - id: adr-002
    resource: /adrs/002-docker-socket-sibling-containers.md
    title: Docker socket sibling containers
  - id: setup
    resource: packages/server/src/__tests__/helpers/setup.ts
    title: Test helpers — MockDockerPort
---

# Agent image refresh — content-hash label rebuild

An operational-correctness bugfix to the Docker substrate: make `ensureAgentImage`[^docker] detect when the built `agent-land-pi` image no longer matches the `/agent-image` source it was built from, and rebuild it before the next session starts — without changing the session lifecycle.

## Approach

**Content-hash label, stamped at build time by the server itself.** `ensureAgentImage` computes a canonical content hash of the `/agent-image` directory it builds from, and passes it as an image label when it runs `docker build`. On every subsequent call it recomputes the hash from the same `/agent-image` and compares it against the existing image's label: match ⇒ no-op; absent image, missing label, or mismatch ⇒ rebuild.

This is the label variant of the learning's candidate fix[^staleness], with one mechanical choice that removes the canonicalization risk: **the same Node hash function computes the hash on both sides**, so there is no build-side/runtime-side drift. The stamp lives on the *agent* image (built by `ensureAgentImage` from `/agent-image`), not on the platform image — so no build driver (Dokku / `docker compose` / CI) needs to learn how to stamp anything. The platform image keeps doing exactly what it does today: `COPY agent-image/ /agent-image/`.

Re-pointing the mutable `:latest` tag on rebuild is what makes the lifecycle safe: Docker re-tags the new image and leaves the old one dangling, but running containers hold the old image *by ID*, so they keep running untouched; only containers created after the rebuild resolve the re-pointed tag. `recover()` never calls `ensureAgentImage` and re-attaches to the existing container, so recovery is unaffected[^session-service]. Container presence remains the ground truth[^session-lifecycle].

## Interfaces

- `DockerPort.ensureAgentImage(image: string): Promise<void>` — **signature unchanged**. Internals change: compute hash → `inspect()` label compare → conditional `docker build`.
- New pure helper `packages/server/src/infra/agent-image-hash.ts`: `hashDir(dir: string): Promise<string>` — recursive walk, regular files only (symlinks and dirs skipped), entries sorted by relative path (bytewise), sha256 of `path + "\0" + sha256(content)` per file, one final sha256 over the concatenation. Exported for unit testing; used identically for stamping and comparison.
- Label key: `agent-land/agent-image-hash`. Build invocation becomes `docker build /agent-image -t <image> --label agent-land/agent-image-hash=<hash>` — no `agent-image/Dockerfile` change, no root `Dockerfile` change.
- **No new env var, no new API route, no new session field, no CLI surface.** Prod vs. local-dev is one uniform behavior (Q3); a future registry pull would add an opt-in `AGENT_IMAGE_PULL` config, deferred.

## Risks & mitigations

- **Slow rebuild stretches the create path (client timeout → orphaned session).** Mitigation: single-flight (Q6) removes thundering-herd; the rebuild fires at most once per deploy; the resume-not-restart discipline is already documented[^loopback]. Eager boot-time refresh is recorded as a deferred optimization.
- **Hash canonicalization drift between build and runtime.** Mitigation: a single shared `hashDir` stamps *and* compares — no dual shell pipelines, and no mtime/mode in the hash (content only).
- **Concurrent rebuilds.** Mitigation: in-process single-flight (a `Map<image, Promise<void>>` keyed by tag). Cross-process duplication (multiple `docker compose` replicas) is possible but benign — `docker build -t` is idempotent and only tags on success, so a duplicate yields the same image. Dokku runs one web process.
- **Fail-open masks persistent staleness.** Mitigation: rebuild failure is logged at error level; the stale image stays tagged and usable, and staleness self-heals on the next deploy whose rebuild succeeds.
- **A failed build must not strand `:latest`.** Docker applies `-t` only on successful build, so a failed rebuild leaves the previous `:latest` tagged and runnable — exactly the fail-open fallback.
- **Mount single-writer window.** `ensureAgentImage` stays after the mount-in-use check and before container creation[^session-service]; no new mount binding/unbinding is introduced. Pipeline stage children bind the checkout mount one at a time, and the rebuild fires once per deploy, not per child.

## Answers to the Feature note's open questions

1. **Staleness signal.** A **content-hash label** on the built agent image (`agent-land/agent-image-hash`), computed and stamped by `ensureAgentImage` itself at build time from `/agent-image`, recomputed at runtime by the same function. Not a stamp file (it would need a self-exclusion rule), not a registry digest (no registry exists). Canonicalization is single-sourced in `hashDir`: regular files only, bytewise path sort, content-only — identical on both sides by construction.
2. **Registry pull vs. rebuild.** **Rebuild from `/agent-image` everywhere in v1.** Registry pull is **deferred**: no `docker push`/registry exists anywhere in the repo, and a CI build+push would add a human-managed deploy credential that stays outside agent containers. Revisit only when a publish step is adopted.
3. **Prod vs. local-dev detection.** **One uniform behavior** — rebuild from `/agent-image` — works identically in Dokku and `docker compose` because both run the same root `Dockerfile` that embeds `/agent-image`. No new env var, no `NODE_ENV`-based branch. If `/agent-image` is absent (server run outside the image), `ensureAgentImage` degrades to today's build-if-absent-only behavior.
4. **Where the stamp comes from, mechanically.** `ensureAgentImage` computes the hash and passes `--label` on its own `docker build /agent-image` invocation. No build-driver change, no committed stamp file, no build-arg plumbing. A deployed platform image always carries fresh `/agent-image`; the agent image carries the label recording which `/agent-image` it was built from.
5. **Latency / slow first create.** **Stay lazy on the create path, single-flighted.** The common path is `inspect()` + hash compare (~ms); the rebuild fires only on mismatch (once per deploy) — the same cost as today's first-build. Eager boot-time refresh is **deferred** as a follow-up if the documented timeout wrinkle[^loopback] persists in practice.
6. **Concurrency / single-flight.** **In-process single-flight** — a `Map<image, Promise<void>>` in `DockerService`; concurrent `createSession` calls await the same in-flight build, so both resolve the post-refresh image. Sufficient for Dokku's single web process; cross-process duplicate rebuilds are idempotent and harmless.
7. **Tag strategy.** **Keep mutable `agent-land-pi:latest` and re-point on rebuild.** `AGENT_IMAGE` stays stable; old containers keep the old image by ID (lifecycle-safe), and new containers resolve the re-pointed tag. Content-addressed tags are deferred — auditability isn't worth the `AGENT_IMAGE` re-point and orphan-tag bookkeeping for v1.
8. **Failure semantics / lifecycle bounds.** **Fail-open when the image exists (stale):** a failed rebuild logs at error level and the session proceeds on the stale image. **Fail-closed when the image is absent:** a first-build failure throws, as today (no fallback exists). Confirmed bounds: `recover()` does not call `ensureAgentImage`; running and re-attached sessions keep their existing image (recovery re-attaches to the existing container, ground truth[^session-lifecycle]); no new session field.
9. **Cleanup / GC.** **No automated GC in v1.** Re-pointed-away images become dangling `<none>` but stay referenced by live containers; document `docker image prune` guidance and defer automated cleanup (mirrors the Mount primitive's manual-only cleanup).

## Minimal change set

- `packages/server/src/infra/agent-image-hash.ts` — **new**: `hashDir` (canonical, exported, pure).
- `packages/server/src/infra/docker.ts` — `ensureAgentImage`: hash → label compare → conditional rebuild → single-flight → fail-open/fail-closed.
- `packages/server/src/__tests__/agent-image-hash.test.ts` — **new**: canonicalization (ordering, nested dirs, symlink skip, content-only).
- `packages/server/src/__tests__/docker.test.ts` — **new** (via the fake `DockerPort` pattern in `helpers/setup.ts`[^setup]): inspect-label match ⇒ no build; mismatch ⇒ build with `--label`; absent ⇒ build; in-flight dedupe; fail-open on stale-rebuild failure.
- Docs on merge (suppression rule): deprecate `/learnings/agent-image-staleness.md` with an inline pointer forward; flip the "Agent image updates reach the host ❌ Gap" row in `/playbook/dogfooding.md`; clean the `/learnings/index.md` entry; update §4 of `/learnings/first-loopback-run.md` (the `dokku config:set AGENT_IMAGE` tag-bump workaround becomes obsolete).

## ADR pointer

No new ADR. This is a bugfix to the existing Docker substrate — it changes *when* the image is rebuilt, not *what* the engine is (invariants #2, #4, #6 hold)[^engine]. It runs through the existing socket-sibling model[^adr-002] using the `docker` CLI already installed in the runtime image.

[^feature]: [Agent image refresh Feature note](/product/features/agent-image-refresh.md)
[^engine]: [Agent Land engine](/platform/engine.md)
[^docker]: `packages/server/src/infra/docker.ts` — `ensureAgentImage()`, `createInteractiveContainer()`
[^session-service]: `packages/server/src/core/session-service.ts` — `createSession()` ordering; `recover()` never calls `ensureAgentImage`
[^staleness]: [Agent image staleness on deploy](/learnings/agent-image-staleness.md)
[^loopback]: [First loopback run](/learnings/first-loopback-run.md) — tag-bump workaround and the lazy-rebuild timeout wrinkle
[^session-lifecycle]: [Session lifecycle](/learnings/session-lifecycle.md) — container presence is ground truth
[^adr-002]: [ADR 002 — Docker socket sibling containers](/adrs/002-docker-socket-sibling-containers.md)
[^setup]: `packages/server/src/__tests__/helpers/setup.ts` — `MockDockerPort`
