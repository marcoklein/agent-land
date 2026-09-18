---
type: Design
title: Scheduled maintenance — weekly dep-bump + stale-PR triage
description: A weekly `maintenance.yml` GitHub Actions workflow running two human-gated, idempotent jobs — a `chore(deps): weekly dependency bump` PR and a stale-PR triage comment — never merging, deploying, or auto-closing.
status: draft
tags: [playbook, maintenance, cron, dogfooding, phase-4]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-18T23:45:00Z }
sources:
  - id: feature
    resource: /product/features/scheduled-maintenance.md
    title: Feature note — scheduled maintenance (issue #87)
  - id: pipeline-trigger
    resource: .github/workflows/pipeline-trigger.yml
    title: Pipeline trigger workflow (marker-idempotency reference)
  - id: ci
    resource: .github/workflows/ci.yml
    title: CI workflow (sops/age + typecheck + test steps to mirror)
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding playbook — Phase 4 trust ladder
---

# Scheduled maintenance design

## Approach

A standalone `.github/workflows/maintenance.yml` (weekly `schedule` + `workflow_dispatch`, on `main`) with two jobs. This is pure composition over the GitHub API — **no engine change, no session, no Mount, no loopback, no LLM**; deterministic `gh`/`pnpm`/`jq` bash only. It is the generic-cron sibling of `pipeline-trigger.yml`, but unlike it needs no `AGENT_LAND_*` secrets.

**Least-privilege permissions:** `contents: write` (push branch), `pull-requests: write` (open PR), `issues: write` (triage comments). Nothing else. Both jobs are human-gated — a PR or a comment, never a merge, deploy, or auto-close — and no-ops when there is nothing to do.

## Interfaces

**Workflow** `.github/workflows/maintenance.yml`
- `on: { schedule: [{ cron: "0 9 * * 1" }], workflow_dispatch: {} }` — Monday 09:00 UTC, default branch (`main`).
- Two jobs: `dep-bump`, `stale-pr-triage`.
- Secret: `GITHUB_TOKEN` only (via `github.token`).

**dep-bump job** (recipe, mirroring `ci.yml` where noted)
1. `actions/checkout` → `pnpm/action-setup` + `setup-node` (node 22, cache pnpm).
2. Gate: `pnpm outdated -r --format json` — exit 1 means "outdated found" (work to do); exit 0 means "nothing to do" (green no-op).
3. `pnpm update` (respects semver ranges; no major jumps) → `pnpm install` (updates lockfile).
4. Verify-before-PR (leave it green): install sops+age (as `ci.yml`), then `pnpm typecheck`, then `pnpm test`.
5. `git checkout -b chore/deps-weekly` → commit as `github-actions[bot]` → push.
6. `gh pr create --title "chore(deps): weekly dependency bump"` **guarded by an open-PR-title check**: if any open PR with that exact title exists, skip (≤1 PR/week). Push only the feature branch — never `main` (`deploy.yml` fires on `main` push).

**stale-pr-triage job** (recipe)
1. `gh pr list --state open --search "updated:<$(date -d '7 days ago' -u +%Y-%m-%d)" --json number,title,author`.
2. Per PR: skip if any comment by `github-actions[bot]` contains marker `<!-- maintenance:stale-triage:2026-W38 -->`.
3. Else `gh pr comment` — "idle >7 days, please update/confirm/close" + marker (≤1 comment/PR/week).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Duplicate bump PR / triage comment in one week | Title latch (dep-bump) + weekly marker comment (triage); a second run is a no-op |
| `pnpm outdated -r` exits 1 on stale deps | Treated as the work signal, not a failure; exit 0 is the clean "nothing to do" |
| Bump PR breaks CI | Job runs typecheck+test before opening; CI re-runs on the PR |
| `main` push triggers deploy | Only `chore/deps-weekly` is pushed; `main` is protected |
| Triage nags the bot's own PRs or drafts | Exclude PRs authored by `github-actions[bot]` and drafts |
| Job failure goes unnoticed | Job fails red (no silent retry); operator fixes, next run retries |

## ADR pointers

- [Dogfooding playbook](/playbook/dogfooding.md) — Phase 4 deliverable; Phase 5 stays gated until this runs clean. No new ADR: pure composition outside the engine, like `pipeline-trigger.yml`.
- [Mount design](/product/designs/mount-design.md) — single-writer invariant; this job deliberately uses its own checkout + branch, not a session/Mount.

## Minimal change set

- **New:** `.github/workflows/maintenance.yml` (the workflow; both jobs inline, no new engine/session/Mount/loopback/LLM).
- **Modified:** `docs/knowledge/product/designs/index.md` (this entry).
- On merge: promote the Feature note to `stable`; later flip the dogfooding "recurring maintenance" row and add a learning note.

## Open questions answered

- **Execution shape** — plain `gh`/`pnpm` bash steps, not loopback sessions (no platform uptime dependency).
- **Dep-bump scope** — whole workspace, one PR, within semver ranges; majors deferred.
- **Idle definition** — no human commit/comment in >7 days (`updated:` proxy); bot PRs and drafts excluded.
- **Idempotency latch** — dep-bump: open-PR-title check; triage: weekly marker comment (ISO week).
- **Failure mode** — red job, operator-fixed, no silent retry.
- **Secrets** — `GITHUB_TOKEN` only; no `AGENT_LAND_URL`/`AGENT_LAND_BASIC_AUTH`.
