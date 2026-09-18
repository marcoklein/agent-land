---
type: Feature
title: Weekly Maintenance
description: A scheduled GitHub Actions workflow (weekly + workflow_dispatch) that runs two human-gated maintenance jobs — a dependency-bump PR and stale-PR triage comments — never merging, deploying, or auto-closing.
status: draft
tags: [dogfooding, maintenance, composition, github-actions]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-17T23:59:51Z }
sources:
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: vision-board
    resource: /product/goals/vision-board.md
    title: Product vision board
  - id: pipeline-trigger
    resource: .github/workflows/pipeline-trigger.yml
    title: Pipeline trigger — the existing cron counterpart
---

# Weekly Maintenance

Phase 4 of the [dogfooding trust ladder](/playbook/dogfooding.md) — recurring maintenance that needs no human. This is the generic-cron counterpart to the already-shipped [pipeline trigger](../../../.github/workflows/pipeline-trigger.yml), which only scans for `pipeline-ready` issues. The new workflow adds the two recurring jobs the playbook still does by hand: dependency bumps and stale-PR triage. It is pure **composition** — a schedule, not an engine change. The six primitives ([engine](/platform/engine.md)) are untouched; the workflow lives above them exactly like every other recipe, gate, and schedule, consistent with the domain boundary's in-scope list of "workflows, schedules, and gate disciplines"[^boundary][^engine].

## Why

Dependencies drift and PRs rot silently between pipeline runs. Today neither is caught without the operator noticing: `pnpm outdated` is run by hand, and stale PRs sit until someone pokes them. The vision board names "recurring work that needs no human" as a business goal[^vision-board], and Phase 4 of the dogfooding roadmap is exactly this deliverable — a cron workflow that opens a maintenance PR every week without being asked[^dogfooding]. The trust ladder stays intact: the workflow **proposes** (opens a PR, posts a comment) and never **acts** (no merge, no deploy, no auto-close), so Phase 5 stays gated until this phase runs clean.

## User stories

- As an operator, I want a weekly dependency-bump PR opened automatically, so outdated dependencies surface for review without me running `pnpm outdated` by hand.
- As an operator, I want open PRs that have been idle (no commit or comment) for more than 7 days to get an attention-or-close comment, so the review queue stays honest instead of silently rotting.
- As an operator, I want the workflow to be a **no-op** when there is nothing to do, so the repo is never polluted with empty PRs or redundant comments.
- As an operator, I want the workflow to be **idempotent** — a second run in the same week opens no duplicate bump PR and no duplicate triage comment — so a `workflow_dispatch` re-run is safe.
- As an operator, I want everything the workflow produces to be **human-gated** (no merge, no deploy, no auto-close), so trust is earned per the ladder, not granted.

## Acceptance criteria

- A `.github/workflows/maintenance.yml` exists with a weekly `schedule` cron **and** a `workflow_dispatch` trigger, running two jobs: dependency bump and stale-PR triage.
- **Dep-bump job:** detects outdated dependencies workspace-wide (`pnpm outdated`) and, when any exist, opens exactly one PR titled `chore(deps): weekly dependency bump` on a dedicated branch, left green for human review. When none exist, it exits 0 with a "nothing to do" message and no PR.
- **Stale-PR job:** enumerates open PRs and, for each with no commit or comment activity for more than 7 days, posts a comment asking for attention or closure. It posts at most one triage comment per PR per week.
- **Idempotency:** a second run in the same week produces no duplicate bump PR and no duplicate triage comment (guarded by checking for an existing open bump PR and for an existing triage marker on each PR).
- **No merge, no deploy, no auto-close** anywhere in the workflow — every artifact it produces is human-gated.
- **End-to-end verification:** a `workflow_dispatch` run against this repo completes green and yields either the expected PR/comment or a clean "nothing to do" exit.

## Open questions

1. **Bump mechanics.** Does the dep-bump job update `pnpm-lock.yaml` in place (`pnpm update`/`pnpm up`), and which version range is applied (patch/minor only, deferring majors)? Or does it only *report* outdated deps and let a later pipeline stage apply them?
2. **Idempotency markers.** How does the stale-PR job recognize its own prior comment — a fixed marker string, or comment author + age? If the operator replies to the triage comment, does that reply count as "activity" that resets the 7-day idle clock for the next run?
3. **Branch strategy.** Does the bump job force-push to a stable branch (e.g. `chore/deps/weekly`) or use a per-week branch? How does it behave when a previous week's bump PR is still open and unmerged?
4. **Staleness definition.** Is "idle" measured on commits only, or commits + comments? Does the workflow's own triage comment reset the idle window (and must it, to satisfy the once-per-week rule)?
5. **Red bump PRs.** The bump branch is expected green; if a dependency update breaks CI (the existing [ci.yml](../../../.github/workflows/ci.yml) runs on `pull_request`), who owns the failure — does the job skip that dependency and reopen, or flag it for human triage?
6. **Token scope.** What is the minimal `GITHUB_TOKEN` permission set (`contents: write` for branches/PRs, `pull-requests: write` for comments), and does it stay scoped to match the playbook's secret-hygiene rule?

[^engine]: [Agent Land engine](/platform/engine.md) — six primitives; schedules are composition, external to the engine
[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md) — workflows, schedules, and gate disciplines are in scope
[^vision-board]: [Product vision board](/product/goals/vision-board.md) — "recurring work that needs no human" is a business goal
[^dogfooding]: [Dogfooding strategy](/playbook/dogfooding.md) — Phase 4: scheduled maintenance
