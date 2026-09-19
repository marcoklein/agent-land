---
type: Design
title: Scheduled maintenance — weekly dep-bump + stale-PR triage
description: One weekly GitHub Actions workflow, two idempotent jobs that open a within-range dependency-bump PR and comment on idle PRs — human-gated, no merge, no deploy.
status: draft
tags: [dogfooding, maintenance, cron, github-actions, idempotency]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-19T21:24:36Z }
sources:
  - id: feature
    resource: /product/features/scheduled-maintenance.md
    title: Scheduled maintenance Feature note
  - id: trigger
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger — the shipped cron and marker-comment precedent
  - id: ci
    resource: ../../../.github/workflows/ci.yml
    title: CI workflow — the checks a bump PR must stay green against
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding playbook — Phase 4 trust ladder
  - id: product-adr
    resource: /adrs/017-product-layer-okf-memory.md
    title: Product layer on OKF memory
---

# Scheduled maintenance

## Problem

Recurring upkeep — outdated dependencies and PRs left idle — today needs a human to remember and run it, so it decays between sessions. Phase 4 of the [dogfooding ladder](/playbook/dogfooding.md) is "recurring work that needs no human": a weekly workflow that surfaces the work as reviewable PRs and comments, never merges or deploys. It is the generic-cron sibling of the shipped [pipeline trigger](/learnings/scheduled-pipeline-trigger.md), which only starts the pipeline for `pipeline-ready` issues[^feature][^trigger].

## Decision requested

1. One `.github/workflows/maintenance.yml` with two independent jobs (dep-bump, stale-PR triage), on a weekly schedule plus `workflow_dispatch` — vs. one combined job or two separate workflows (rejected: two concerns, one trigger surface).
2. `GITHUB_TOKEN` only, with green proven inline by the workflow — vs. a scoped PAT so bump PRs re-trigger CI (rejected: a stored secret with wider blast radius buys nothing Phase 4 needs).
3. Idempotency by GitHub object lookup — the dep-bump PR's head branch and a fixed triage-marker comment — vs. a state artifact in the repo (rejected: GitHub already holds the state durably).

## Approach

One weekly workflow, two jobs, no merge, no deploy, no auto-close. Both jobs are idempotent through objects GitHub already stores, so a same-week re-run and a missed schedule both settle cleanly.

- **dep-bump** — detect outdated deps workspace-wide (`pnpm outdated -r`); none → clean no-op exit. Otherwise apply within-range updates (`pnpm update -r`), verify green inline (the `ci.yml` checks: install, typecheck, test), commit `package.json` + `pnpm-lock.yaml` on a week-scoped branch `chore/deps-<ISO-week>`, and open `chore(deps): weekly dependency bump`. Re-run guard: skip if an open PR already has that head branch.
- **stale-pr-triage** — list open PRs not updated in 7 days (`gh pr list --search "updated:<7-days-ago>"`); for each, post a marker comment with a fixed prefix unless the marker is already present, so a flagged PR is never re-commented until it closes.

## Interfaces

- **Workflow file** `.github/workflows/maintenance.yml` — `on: { schedule: "0 6 * * 1", workflow_dispatch }` (weekly Monday 06:00 UTC), jobs `dep-bump` and `stale-pr-triage` on `ubuntu-latest`, no job dependency.
- **permissions** — `{ contents: write, pull-requests: write, issues: write }`: branch push + PR create need contents/pull-requests; PR issue comments need issues.
- **env/secrets** — `GH_TOKEN: ${{ github.token }}` only. No PAT, no new repo secret; the npm registry is public, so `pnpm outdated` needs no auth.
- **Identity markers** — dep-bump PR head branch `chore/deps-<ISO-week>` (title stays the fixed string, so it may repeat across weeks); triage comment prefix `🤖 Maintenance: stale-PR triage`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Idempotency race — two same-week runs both pass the guard | the week branch name is deterministic; both push the same branch and the second `gh pr create` fails on the existing head, treated as already-done |
| `GITHUB_TOKEN` PRs do not re-trigger CI | the job runs the `ci.yml` checks inline before opening the PR, so green is established by the workflow run itself; the human re-runs on demand |
| Token scope | default `GITHUB_TOKEN`, permissions narrowed to the three scopes above; nothing to store or rotate |
| Quiet week → noise | each job exits 0 with a "nothing to do" line when no outdated deps, no stale PRs, or the marker already exists |
| Major-version bumps slip into the weekly PR | `pnpm update -r` honors the semver ranges already in `package.json`, so majors are excluded by construction and stay a human decision |
| Marker false-match | the prefix is fixed and unique; a human-authored lookalike is read as "already flagged" — the safe direction |
| Missed schedule | week-scoped branch names are monotonic; a missed week is skipped, the next week opens its own PR with no collision |

## ADR pointers

**No new ADR.** This is a composition change in the playbook layer, the same shape as the shipped `pipeline-trigger.yml` — no engine primitive, no server code, no API change[^product-adr]. The relevant existing record is the [pipeline trigger](/learnings/scheduled-pipeline-trigger.md), whose marker-comment idempotency this design generalizes from issue comments to PR objects.

## Minimal change set

- `.github/workflows/maintenance.yml` — new; the only file.
- **No package/script change.** The jobs shell out to `gh`, `pnpm`, and `date`; `pnpm outdated -r` / `pnpm update -r` are stock pnpm commands, and the inline checks reuse the `ci.yml` steps[^ci].
- No new secrets, no ADR, no engine/server change.

## Answers to the Feature note's open questions

1. **Idempotency guard — GitHub object lookup.** Head-branch PR (dep-bump) and marker comment (triage) live in GitHub, so they survive same-week re-runs and missed schedules; no repo state artifact.
2. **PR identity — week-scoped head branch.** `chore/deps-<ISO-week>` is the match key; the title stays the fixed string and may repeat across weeks.
3. **Stale signal — `gh pr list --search "updated:<date>"`.** Reads last activity of any kind; a bot comment does not re-arm because the marker latches — a flagged PR is not re-commented until it closes.
4. **`pnpm outdated` scope — workspace-wide (`-r`).** Majors are excluded by the package.json semver ranges, not by the workflow.
5. **Permissions — `GITHUB_TOKEN`.** Green is proven inline rather than by re-triggering CI with a PAT.

[^feature]: [Scheduled maintenance Feature note](/product/features/scheduled-maintenance.md)
[^trigger]: [Scheduled pipeline trigger](/learnings/scheduled-pipeline-trigger.md)
[^ci]: `.github/workflows/ci.yml`
[^dogfooding]: [Dogfooding playbook](/playbook/dogfooding.md) — Phase 4
[^product-adr]: [ADR 017 — product layer on OKF memory](/adrs/017-product-layer-okf-memory.md)
