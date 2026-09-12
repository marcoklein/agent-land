---
type: Feature
title: Scheduled maintenance
description: A weekly GitHub Actions workflow that opens a dependency-bump PR and nudges idle PRs — recurring maintenance that needs no human, with every output human-gated.
status: draft
tags: [scheduled, cron, github-actions, maintenance, dogfooding, trust-ladder]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-12T10:12:04Z }
sources:
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the purest form
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: vision-board
    resource: /product/goals/vision-board.md
    title: Product vision board
  - id: dogfooding
    resource: /dogfooding.md
    title: Dogfooding — developing agent-land on agent-land
  - id: pipeline-trigger
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger — cron starts the pipeline with nobody at a terminal
  - id: roadmap
    resource: /multi-agent-workflow.md
    title: Multi-agent workflow — from vision to review-ready PRs
---

# Scheduled maintenance

Dogfooding Phase 4 of the [trust ladder](/dogfooding.md) — recurring maintenance that needs no human. This is the generic-cron counterpart to the already-shipped [`pipeline-ready` trigger](/learnings/scheduled-pipeline-trigger.md): a weekly GitHub Actions workflow that performs two safe, non-destructive jobs and opens PRs/comments for human review. It never merges and never deploys.

## Fit-check

- **Boundary** — in scope. The outcome is a *schedule*, explicitly named in [the engine's](/engine.md) composition layer ("Schedules — cron or triggers that call the API. External."), the same class as the already-shipped [`pipeline-trigger.yml`](/.github/workflows/pipeline-trigger.yml). It adds or changes **no primitive** — no Connector, Provider, Mount, Session, Event Stream, or Platform Connector — and introduces no in-core UI, no in-core orchestration (a GitHub Actions cron is an external schedule, not a workflow executor in the engine), no vendor knowledge, and no database[^boundary][^engine]. Everything it produces is a PR or a comment: human-gated artifacts in the repo, not engine state.
- **Vision board** — worth building. It serves *autonomy with trust* (runs unattended, but every output pauses at a human) and the business goal *recurring work that needs no human* — maintenance PRs that just appear[^vision-board]. It is the explicit deliverable of dogfooding **Phase 4** ("a cron workflow that opens a maintenance PR every week without being asked"), and Phase 5 (gated self-service merge + deploy) is explicitly blocked until this phase runs clean[^dogfooding][^roadmap].

No scope deviation.

## Why

Recurring upkeep still needs a human to remember and start it: dependencies drift until someone happens to run `pnpm outdated` and open a PR, and stale PRs rot silently because nobody notices how long they've been idle. The platform already removed the human *start* nudge for the product pipeline — [`pipeline-trigger.yml`](/.github/workflows/pipeline-trigger.yml) turns a `pipeline-ready` label into spec/design PRs with nobody at a terminal — but there is no generic counterpart for the unglamorous, periodic maintenance the trust ladder's Phase 4 demands[^pipeline-trigger]. This feature adds a weekly cron that does two safe, deterministic jobs — bump outdated dependencies into a reviewable PR and nudge idle PRs with a comment — and leaves every output for a human to review, merge, or close. It produces **signals, not decisions**: never a merge, never a deploy, never an auto-close.

## User stories

- As an operator, I want a weekly cron to detect outdated workspace dependencies and open a `chore(deps): weekly dependency bump` PR, so dependency bumps appear without me remembering to run `pnpm outdated`.
- As an operator, I want the cron to comment on open PRs that have been idle (no commit/comment) for more than 7 days, so stale work gets attention or a nudge toward closure instead of rotting.
- As an operator, I want the workflow runnable on demand (`workflow_dispatch`) in addition to the weekly schedule, so I can verify it end-to-end and trigger maintenance without waiting for the cron.
- As an operator, I want a run to be a clean no-op when there is nothing to do, so I don't get empty PRs or comment spam.
- As an operator, I want repeated runs in the same week to be idempotent — at most one dep-bump PR per week and at most one triage comment per PR per week — so a re-run or manual dispatch never duplicates work.
- As an operator, I want the workflow to never merge, deploy, or auto-close anything, so maintenance stays human-gated per the trust ladder (Phase 5 stays blocked until Phase 4 runs clean)[^dogfooding].

## Acceptance criteria

- A `.github/workflows/maintenance.yml` workflow with a weekly `schedule` cron and a `workflow_dispatch` trigger runs both jobs.
- **Dep-bump job** — runs `pnpm outdated` across the workspace; when outdated dependencies exist it opens exactly one PR titled `chore(deps): weekly dependency bump` on a branch off `main`, left green for human review; when none exist it exits 0 with a "nothing to do" message and opens no PR.
- **At most one dep-bump PR per week** — a second run (schedule or dispatch) within the same week detects the already-open bump PR (or that week's marker) and skips rather than opening a duplicate.
- **Stale-PR triage job** — finds open PRs with no commit/comment activity for more than 7 days and posts one comment asking for attention or closure.
- **At most one triage comment per PR per week** — a second run within the same week detects the already-posted comment and does not duplicate it.
- **No empty PRs, no duplicate comments** — both jobs are strict no-ops when there is nothing to do.
- **No merge, no deploy, no auto-close** — the workflow never invokes merge/close/delete endpoints and has no deploy step; everything it produces is human-gated.
- **End-to-end verified** — a `workflow_dispatch` run against this repo completes green and produces either the expected PR/comment or a clean "nothing to do" exit.

## Open questions

The Design note must answer these:

1. **Idempotency mechanism per job.** How is "already done this week" detected? Dep bump: look for an existing open PR with the `chore(deps): weekly dependency bump` title/branch, or a marker (label, comment, or a checked-in state file)? Triage: a marker comment on the PR, or comparing comment timestamps/body signature? Prefer signals reachable via `gh` with no new persisted state; if a marker comment is used, decide whether that marker itself counts as "activity" that resets the 7-day idle clock.
2. **Definition of "idle for more than 7 days".** What counts as activity — commits, comments, or both — and what query pins it down (`gh pr list --state open` filtered on `updated_at`/`pushed_at`)? After a PR is nudged once, does it get nudged again the following week if it stays idle, or only once ever? The issue says "no commit/comment for more than 7 days"; the design must fix the exact predicate and the "once per PR per week" window boundary.
3. **Scope of `pnpm outdated` and a green PR.** Recursive across all workspace packages (`-r`)? The bump PR must pass CI, which runs `pnpm install --frozen-lockfile` — so does the workflow regenerate `pnpm-lock.yaml` and run the checks (`pnpm typecheck`, `pnpm test`) in-workflow before opening the PR, or does it only update manifests and leave the lockfile to the human (which would open a red PR)?
4. **Branch, commit, and permissions.** Branch naming (`chore/deps-weekly-YYYY-MM-DD`?), how the PR body surfaces the outdated packages for review, and the workflow's `permissions:` block — grant the least privilege (`contents: write` + `pull-requests: write`, plus whatever the triage comment needs) so merge/deploy/close are impossible in principle, not just by convention.
5. **No-merge/no-deploy/no-close enforcement.** Confirm the workflow's permission set excludes `deployments`, `actions`, and any close/merge capability, and that neither job contains a deploy or merge step — making "human-gated" structural, not a promise in a comment.
6. **Failure semantics.** If `pnpm outdated` fails transiently or `gh` errors mid-run, does the workflow fail loudly (red run) or degrade to a "nothing to do" no-op? Given the trust ladder's caution, a failed maintenance run should arguably be noisy rather than silently skipped — the design should choose.
7. **Week window.** Is "per week" the calendar week, a rolling 7-day window, or keyed to the cron's weekly boundary? Both idempotency windows (dep-bump PR, triage comment) should share one definition.

[^engine]: [Agent Land engine](/engine.md) — six primitives, everything else is composition.
[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md) — composition outside the engine is in scope.
[^vision-board]: [Product vision board](/product/goals/vision-board.md) — "is it worth building?"
[^dogfooding]: [Dogfooding strategy](/dogfooding.md) — Phase 4 deliverable and the Phase 5 risk gate.
[^pipeline-trigger]: [Scheduled pipeline trigger](/learnings/scheduled-pipeline-trigger.md) — the already-shipped cron counterpart.
[^roadmap]: [Multi-agent workflow](/multi-agent-workflow.md) — Phase 3 maps to dogfooding Phase 4.
