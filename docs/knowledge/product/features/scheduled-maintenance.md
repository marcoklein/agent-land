---
type: Feature
title: Scheduled maintenance — weekly dep-bump + stale-PR triage
description: A weekly GitHub Actions cron (the generic-cron counterpart to the pipeline-ready trigger) running two human-gated maintenance jobs — a dependency-bump PR and a stale-PR triage comment — that never merge, deploy, or auto-close.
status: draft
tags: [playbook, maintenance, cron, dogfooding]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-18T00:00:00Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
  - id: pipeline-trigger
    resource: .github/workflows/pipeline-trigger.yml
    title: Pipeline trigger workflow (the existing cron counterpart)
---

# Scheduled maintenance — weekly dep-bump + stale-PR triage

Dogfooding Phase 4 of the [trust ladder](/playbook/dogfooding.md#roadmap): recurring maintenance that needs no human. The engine already has the [pipeline-ready trigger](/playbook/dogfooding.md#the-playbook-inventory) (`pipeline-trigger.yml`) — a cron that spawns orchestrator sessions for labeled issues. This is its generic-cron counterpart: a weekly `maintenance.yml` workflow that runs two safe, non-destructive jobs and hands the result to a human at a gate.

## Why

Maintenance drift is the first thing that silently rots an unattended platform: dependencies go stale, PRs languish, and the operator is the only one who notices. Dogfooding's Phase 4 says recurring work should *run on its own* — the same way the pipeline trigger already does for tickets — with the agent proposing and the human disposing. Dep-bumps and stale-PR nags are the lowest-risk recurring jobs that still produce real value: both are read-and-propose actions that end in a PR or a comment, never a merge, deploy, or auto-close. Shipping them earns the "recurring work that needs no human" success signal and unblocks Phase 5 (gated merge + deploy), which is explicitly held back until this phase runs clean[^dogfooding].

## User stories

- As an operator, I want a weekly dependency-bump PR to appear on its own, so I review and merge rather than chase `pnpm outdated` myself.
- As an operator, I want open PRs that have sat idle for more than a week to get an attention-or-close comment, so stale work surfaces instead of silently expiring.
- As an operator, I want the workflow to do nothing (no empty PR, no duplicate comment) when there is nothing to do, so I'm never nagged by noise.
- As an operator, I want a second run in the same week to be a no-op, so re-running is safe and idempotent.
- As the operator, I want every output human-gated (PR or comment, never a merge/deploy/close), so the trust ladder is respected and Phase 5 stays blocked until this phase runs clean.

## Acceptance criteria

- **Workflow.** A `maintenance.yml` exists at `.github/workflows/maintenance.yml`, triggered by a weekly `schedule` cron on `main` plus `workflow_dispatch`; it runs two jobs: dep-bump and stale-PR triage.
- **Dep-bump job.** Detects outdated workspace dependencies (`pnpm outdated`) and, when any exist, opens at most **one** `chore(deps): weekly dependency bump` PR per week on a branch; when none exist it exits clean with "nothing to do".
- **Stale-PR triage job.** For each open PR idle (no commit/comment) for more than 7 days, comments asking for attention or closure — at most **once per PR per week**.
- **Idempotency.** A second `workflow_dispatch` run in the same week opens no duplicate PR and posts no duplicate triage comment on the same PR (marker/label latch, mirroring `pipeline-trigger.yml`'s marker guard).
- **No destructive actions.** The workflow never merges, never deploys, and never auto-closes a PR — every product is human-gated.
- **End-to-end verification.** A `workflow_dispatch` run against `marcoklein/agent-land` completes green and produces either the expected PR/comment or a clean "nothing to do" exit.

## Open questions

- **Execution shape.** Do the jobs run as plain `gh`/`pnpm` bash steps in the workflow, or as orchestrator sessions spawned through the platform API (loopback) like `pipeline-trigger.yml` does? The former is simpler and does not depend on a live engine; the latter dogfoods the engine but couples maintenance to platform uptime.
- **Dep-bump scope.** Bump all outdated deps in one PR, or split by workspace package / by major-version risk? Does the job update lockfiles (`pnpm install --lockfile-only`) or only manifest ranges?
- **Idle-definition edge cases.** Is "idle" measured from the last commit *or* comment (whichever is newer)? Are draft PRs and PRs with a `human`/`blocked` label excluded from triage?
- **Idempotency latch.** Which latch is authoritative — a PR-branch naming convention, a PR body/comment marker, a label, or a persisted state file? How is "the same week" defined (calendar week vs. rolling 7-day window)?
- **Failure mode.** Should a failed dep-bump/triage job surface as a workflow failure, an issue, or a silent retry on the next scheduled run?
- **Secrets.** Which credentials do the jobs need (`GITHUB_TOKEN` only, or `AGENT_LAND_URL`/`AGENT_LAND_BASIC_AUTH` if they spawn sessions)?

[^engine]: [Agent Land engine — the purest form](/platform/engine.md) — this is composition (a schedule calling the API), not a new primitive; see [the composition layer](/platform/engine.md#the-composition-layer) and [loopback](/platform/engine.md#loopback).
[^dogfooding]: [Dogfooding — the agent-land playbook](/playbook/dogfooding.md) — Phase 4 deliverable and the Phase 5 risk gate.
