---
type: Feature
title: Scheduled maintenance — weekly dep-bump + stale-PR triage
description: A weekly GitHub Actions workflow that opens a dependency-bump PR and comments on idle PRs, human-gated — dogfooding Phase 4, recurring maintenance that needs no human.
status: draft
tags: [dogfooding, maintenance, cron, github-actions, composition]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-19T21:21:24Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — composition layer (Schedules)
  - id: pipeline-trigger
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger — the existing cron
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding playbook — Phase 4
---

# Scheduled maintenance

Phase 4 of the [dogfooding ladder](/playbook/dogfooding.md): a weekly GitHub Actions workflow that performs two safe maintenance jobs and hands the output to a human. It is the generic-cron counterpart to the shipped [pipeline trigger](/learnings/scheduled-pipeline-trigger.md), which only starts the pipeline for `pipeline-ready` issues. No engine change: a cron workflow is **Schedules**, the external-trigger composition the [engine](/platform/engine.md) already names — no session, connector, provider, or mount involved[^engine].

## Why

Recurring upkeep — outdated dependencies and idle PRs — today needs a human to remember and run it, so it decays between sessions. Phase 4 earns trust by making that maintenance appear on its own while staying human-gated: the workflow opens a PR or posts a comment but never merges or deploys, so the operator only reviews. It is the "recurring work that needs no human" success signal, one rung before Phase 5 merge/deploy self-service unlocks[^dogfooding].

## User stories

- As an operator, I want outdated dependencies detected and bundled into a `chore(deps): weekly dependency bump` PR, so I review one green PR instead of running `pnpm outdated` by hand.
- As an operator, I want open PRs idle more than 7 days flagged with a comment, so stale work surfaces for attention or closure without me hunting for it.
- As an operator, I want the workflow to do nothing when there is nothing to do, so a quiet week produces no noise — no empty PRs, no duplicate comments.

## Acceptance criteria

- A `maintenance.yml` workflow runs weekly on `main` and on `workflow_dispatch`, running both jobs.
- **Dep-bump** runs `pnpm outdated` across the workspace; with outdated deps it opens exactly one `chore(deps): weekly dependency bump` PR per week, left green for review; with none, it exits clean.
- **Stale-PR triage** comments at most once per PR per week on open PRs with no commit or comment in the last 7 days; already-flagged PRs are not re-commented.
- No job merges, deploys, or auto-closes — every product is human-gated, per the trust ladder.
- A `workflow_dispatch` run against this repo completes green and yields either the expected PR/comment or a clean "nothing to do" exit.

## Open questions

- **Idempotency guard.** Marker comment, `gh` object lookup (existing PR title / prior comment), or a state artifact — which is durable enough to survive a re-run in the same week and a missed schedule?
- **PR identity.** How does the dep-bump job recognize its own PR from a prior week's run — fixed branch name, PR title match, or a body marker?
- **Stale signal.** Is "no commit/comment in 7 days" read from `gh pr view` timestamps or the full timeline, and does a bot comment reset the clock?
- **`pnpm outdated` scope.** Workspace-wide `pnpm -r outdated` or root only, and are major-version bumps excluded from the weekly PR?
- **Permissions.** Run on `GITHUB_TOKEN` (PRs from the `github-actions` bot, no CI on those PRs) or a scoped PAT so bump PRs trigger CI?

[^engine]: [Agent Land engine](/platform/engine.md) — Schedules are external composition
[^pipeline-trigger]: [Scheduled pipeline trigger](/learnings/scheduled-pipeline-trigger.md)
[^dogfooding]: [Dogfooding playbook](/playbook/dogfooding.md) — Phase 4, trust ladder
