---
type: Feature
title: Weekly maintenance — scheduled dep-bump + stale-PR triage
description: A weekly scheduled GitHub Actions workflow on main that opens a dependency-bump PR and comments on idle PRs — always human-gated, never merging, deploying, or closing anything.
status: draft
tags: [dogfooding, maintenance, cron, github-actions, dependencies, triage, trust-ladder]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-12T05:29:39Z }
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
    resource: ../../../.github/workflows/pipeline-trigger.yml
    title: Pipeline trigger — the existing cron trigger this is the generic counterpart to
  - id: trigger-learning
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger — the idempotency pattern it established
---

# Weekly maintenance

Fit-check (refine stage, before writing this note):

- **Boundary** — in scope. This is pure *composition outside the engine*: a [Schedule](/engine.md#the-composition-layer) (a weekly cron + `workflow_dispatch`) driving a [Workflow](/engine.md#the-composition-layer) of deterministic `gh`/`pnpm` steps. The boundary lists "workflows, schedules, gate disciplines" as deliberately in scope, and the engine's composition layer names schedules as "cron or triggers that call the API. External."[^boundary][^engine]. No engine primitive is added or changed; no UI in-core, no orchestration executor in the engine, no vendor knowledge, no database.
- **Vision board** — worth building. This is the "recurring work that needs no human" success signal verbatim, and the dogfooding strategy's Phase 4 deliverable ("a cron workflow that opens a maintenance PR every week without being asked")[^dogfooding][^vision-board]. It serves *autonomy with trust*: the workflow runs unattended, yet every artifact it produces is human-gated.

No scope deviation.

## Why

Dogfooding Phase 4 of the trust ladder is recurring maintenance that needs no human — and this is the generic-cron counterpart to the already-shipped `pipeline-ready` trigger, which only starts the product pipeline[^pipeline-trigger][^trigger-learning]. Today, dependency drift goes unnoticed until a bump is forced, and stale PRs rot in the queue with nobody nudging them. A weekly scheduled workflow that detects outdated dependencies and opens one `chore(deps)` PR, and that comments once on PRs idle for more than a week, removes the standing human chores without giving the machine any new authority: it never merges, never deploys, and never auto-closes. Phase 5 (gated self-service merge + deploy) is explicitly blocked until this phase runs clean for weeks, so this feature is also the gate that unlocks the next rung[^dogfooding].

## User stories

- As an operator, I want a weekly workflow to open a single `chore(deps): weekly dependency bump` PR when dependencies are outdated, so I review and merge a bounded, human-approved bump instead of discovering drift by surprise.
- As an operator, I want the same workflow to do nothing when dependencies are already current, so I don't get empty PRs or noise.
- As a maintainer, I want a comment posted on any open PR that has been idle (no commit or comment) for more than 7 days, so stale work is either pushed forward or closed deliberately.
- As a maintainer, I want re-runs of the workflow in the same week to be no-ops (no duplicate PR, no duplicate triage comment), so I can `workflow_dispatch` it without spamming the repo.
- As the operator of a self-hosting platform, I want everything the workflow produces to be human-gated (no merge, no deploy, no auto-close), so the trust ladder is respected and Phase 5 stays locked until this phase proves clean[^dogfooding].

## Acceptance criteria

- `.github/workflows/maintenance.yml` exists on `main`, triggered by a weekly `schedule` cron **and** `workflow_dispatch`.
- **Dep-bump job.** Runs `pnpm outdated` across the workspace; when nothing is outdated it exits 0 with a "nothing to do" message and opens **no** branch and **no** PR. When something is outdated it pushes a branch and opens exactly one PR titled `chore(deps): weekly dependency bump`. At most one such PR is open per week: a second run in the same week detects the existing open PR/branch and does not open a duplicate.
- **Stale-PR triage job.** Lists open PRs and comments on each PR whose most recent commit *and* comment are both older than 7 days. It comments **at most once per PR per week**: a second run in the same week detects its own prior comment and does not post again. PRs with recent activity get no comment.
- **Human-gated by construction.** The workflow has no merge, deploy, or close step, and its `GITHUB_TOKEN` permissions are the minimum needed (push to the bump branch + write PR comments) — never `deployments`, never `admin`.
- **Verified end-to-end.** A `workflow_dispatch` run against this repo completes green and produces either the expected PR/comment or a clean "nothing to do" exit; the no-op and idempotency paths are demonstrated by re-dispatching in the same week.

## Open questions

- **Session vs. script.** The issue specifies the jobs as direct `gh`/`pnpm` steps in the workflow, but dogfooding rule 1 is "ship through the tool" — the existing `pipeline-trigger` spawns agent-land sessions via the API rather than doing work itself[^pipeline-trigger][^trigger-learning]. Should these two deterministic jobs stay plain bash (cheap, no session lifecycle to manage), or should the workflow spawn sessions for consistency? Prefer plain bash for deterministic jobs and reserve sessions for judgment work — confirm at the design gate.
- **Idempotency signal for the dep-bump PR.** Detect "one PR per week" by branch name (`chore/deps/weekly-dependency-bump`) via `gh pr list --head`, by a marker in the PR body, or by a marker comment? Branch name is the simplest and survives re-dispatch.
- **Idempotency signal for triage comments.** Marker-string approach (a `<!-- weekly-stale-triage: <iso-week> -->` footer, mirroring the pipeline trigger's START/DONE markers) vs. searching comments for a bot-authored one. The marker must encode the week so "once per PR per week" is testable.
- **Definition of "idle".** Is a PR idle when *both* its last commit and last comment are older than 7 days (any comment, or only human/CI comments)? Does the triage bot's own comment reset the idle timer, or is it excluded?
- **`pnpm outdated` exit code.** `pnpm outdated` exits non-zero when outdated packages exist, which breaks `set -e`; does the job use `--format json` and tolerate the exit code, and does it recurse the workspace with `-r`?
- **"Leaving it green."** The issue says the bump PR is "left green for human review" — does the workflow run `pnpm install` + `pnpm typecheck`/`pnpm test` before opening the PR, or is CI on the PR the gate? If the bump is a breaking major, is the PR still opened?
- **Cadence and job split.** Exact cron day/time, and one workflow with two parallel jobs vs. one job with shared setup (single `pnpm`/`gh` checkout).
- **Committer identity.** Does the bump branch commit as `github-actions[bot]` or a configured `GIT_USER_NAME`/`GIT_USER_EMAIL`?

[^engine]: [Agent Land engine](/engine.md)
[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md)
[^vision-board]: [Product vision board](/product/goals/vision-board.md)
[^dogfooding]: [Dogfooding — developing agent-land on agent-land](/dogfooding.md)
[^pipeline-trigger]: `.github/workflows/pipeline-trigger.yml`
[^trigger-learning]: [Scheduled pipeline trigger](/learnings/scheduled-pipeline-trigger.md)
