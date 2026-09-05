---
type: Feature
title: Mount
description: A named durable folder attached to a session container at a chosen path, realized as a Docker volume, outliving any single session.
status: draft
tags: [engine, storage, isolation, worktree]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: engine
    resource: /knowledge/engine.md
    title: Agent Land engine — the purest form
  - id: archon-inspiration
    resource: /knowledge/learnings/archon-inspiration.md
    title: Inspiration from Archon
---

# Mount

The durable-storage primitive. A named folder that persists across sessions — the Docker-volume equivalent of Archon's per-run git worktree, but content-agnostic.

## Why

Long-lived development needs durable state: the repo checkout, warm caches, skill files, tooling dirs. Today every session starts from an empty filesystem and clones fresh. A Mount hosts the checkout once; sessions attach it and get working state immediately.

## User stories

- As a developer, I want to attach my repo checkout to a session, so I don't re-clone and re-install on every run.
- As a developer, I want parallel runs against the same mount to be conflict-free, so concurrent tasks don't clobber each other (per-run worktree/branch on the mount)[^archon].
- As an operator, I want the mount to outlive the session and be cleaned up explicitly, so state is durable but not leaked.

## Acceptance criteria

- A named mount is created, listed, and removed as a registry entry plus a labeled Docker volume.
- A session can bind one or more mounts at chosen container paths at creation time (M:N attach).
- At most one live session binds a given mount at once.
- The mount is content-agnostic — the platform never inspects or interprets its contents.
- See [engine.md](/knowledge/engine.md#capabilities-injected-at-session-creation) for the primitive spec.

## Open questions

- Is "at most one live session per mount" a hard invariant or a soft policy with a force override?
- Do mounts need size/cleanup tooling (`al mounts prune`) at first ship, or is manual cleanup enough?

[^archon]: [Inspiration from Archon](/knowledge/learnings/archon-inspiration.md) — idea #1, worktree isolation feeding Mount design
