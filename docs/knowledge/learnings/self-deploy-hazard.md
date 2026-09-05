---
type: Reference
title: Self-deploy hazard — merges restart the platform you run on
description: An in-flight al run dies exactly when a merge's deploy swaps the platform container; the run is resumable because the session recovers and the mount survives.
status: draft
generated: { by: opencode/qwen3.8-max, at: 2026-09-05T12:45:00Z }
sources:
  - id: pi-rpc
    resource: /learnings/pi-rpc.md
    title: pi --mode rpc harness — exec-stream lifecycle
  - id: session-lifecycle
    resource: /learnings/session-lifecycle.md
    title: Session lifecycle & redeploy resilience
  - id: deploy-workflow
    resource: .github/workflows/deploy.yml
    title: Deploy workflow — runs on every push to main
---

# Self-deploy hazard

Dogfooding on the live platform is self-referential in one dangerous way: **every merge to `main` deploys the platform your agent sessions run on**[^deploy]. A Dokku deploy rebuilds and restarts the platform container — and the restart kills every in-flight session's `docker exec` stream, so pi exits mid-turn.[^pi-rpc] The `al run` client sees its SSE connection drop and exits with `run failed: terminated`.

## Observed (2026-09-05)

An `al run` implementing the [git-identity design](/product/designs/git-identity-design.md) died at turn 11 — exactly inside the window where the deploy for the PR that enabled it swapped the container (deploy created 12:20:24Z, finished 12:22:34Z). What survived: the session (recovered as `idle` at restart[^session-lifecycle]), its container, the bound mount with its checkout, and pi's conversation transcript. What died: the client run and the in-progress turn.

## Rules

1. **`run failed: terminated` is transport, not agent failure.** Before concluding anything: `al ls` (is the session alive/idle?) and `gh run list --workflow=deploy.yml` (did a deploy land at that moment?).
2. **Wait out the deploy wave.** After merging a platform change, wait for the deploy run to finish before starting `al run` against the same host.
3. **Resume, don't restart.** The recovered session still holds pi's transcript and the mount state: re-attach with `al chat <id>` and re-prompt — the agent continues the same conversation with all its exploration intact. A fresh session would only be blocked by the mount's single-writer guard anyway.
4. **Uncommitted work lives in the mount**, so an interrupted run loses at most its current turn — provided long task prompts instruct the agent to commit and push incrementally instead of one big commit at the end.

[^deploy]: `.github/workflows/deploy.yml` — `on: push: branches: [main]`, pushes to Dokku
[^pi-rpc]: [pi `--mode rpc` harness](/learnings/pi-rpc.md) — web-process death closes the exec stream, pi exits
[^session-lifecycle]: [Session lifecycle](/learnings/session-lifecycle.md) — recovery and re-attach on redeploy
