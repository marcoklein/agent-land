---
type: Design
title: Scheduled maintenance — weekly dep-bump + stale-PR triage
description: One GitHub Actions workflow (weekly cron + workflow_dispatch) running two deterministic, human-gated jobs — dependency bump and stale-PR triage — idempotent via a fixed-branch/title latch and a weekly marker comment, never merging or deploying.
status: draft
tags: [dogfooding, maintenance, github-actions, schedule, composition]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-17T14:53:20Z }
sources:
  - id: feature
    resource: /product/features/scheduled-maintenance.md
    title: Scheduled maintenance — the Feature note this design answers
  - id: pipeline-trigger
    resource: ../../../../.github/workflows/pipeline-trigger.yml
    title: Pipeline trigger workflow — the marker-comment idempotency precedent
  - id: trigger-learning
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger — operator-auth + marker-comment decisions
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — Phase 4 trust ladder
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — Schedule is composition, not engine
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: tools-adr
    resource: /adrs/005-agent-tool-strategy.md
    title: Pre-baked git/curl/jq/gh — inline script posture
  - id: ci
    resource: ../../../../.github/workflows/ci.yml
    title: CI workflow — the checkout/pnpm/setup-node pinning to reuse
---

# Scheduled maintenance — weekly dep-bump + stale-PR triage

This design answers the [Feature note](/product/features/scheduled-maintenance.md) for issue #87 and realizes dogfooding **Phase 4** of [the trust ladder](/playbook/dogfooding.md#roadmap): recurring maintenance that needs no human. It is the generic-cron counterpart to the already-shipped [`pipeline-trigger`](/learnings/scheduled-pipeline-trigger.md) workflow. Where that hourly cron spawns orchestrator sessions, this weekly cron keeps the repository itself healthy. It lives in the [engine's composition layer](/platform/engine.md#the-composition-layer) as a **Schedule** — never in the engine — and produces only human-gated artifacts.

## Approach

A single workflow, `.github/workflows/maintenance.yml`, with two jobs. Both are **deterministic shell script steps on the GitHub Actions runner** — no agent session, no Platform Connector loopback, no orchestration. This is the resolution of the Feature note's *runner vs engine* and *dependency posture* questions in one stroke:

- **Runner, not engine.** The jobs use the pre-baked `gh`/`curl`/`jq`/`git` posture from [ADR 005](/adrs/005-agent-tool-strategy.md). They are deterministic enough to need no agent: detect → act → leave a review artifact. The loopback (`AGENT_LAND_URL`/`AGENT_LAND_BASIC_AUTH`) is only justified when a job must *think*; neither of these jobs thinks. Unlike `pipeline-trigger`, the maintenance workflow therefore **needs no operator secrets at all** — only the run's own `GITHUB_TOKEN`.
- **Inline steps, no marketplace actions.** Beyond the three `ci.yml`-pinned setup actions (`actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`), every step is a `run:` script. No dependabot/stale wrappers — avoids new supply-chain surface.
- **Weekly + manual.** `schedule: cron "0 6 * * 1"` (Mondays 06:00 UTC) plus `workflow_dispatch`, both targeting `main` only.
- **Serialized.** `concurrency: { group: maintenance, cancel-in-progress: false }` so an overlapping dispatch queues behind the scheduled run instead of racing it. This is the second half of every idempotency story below.
- **Human-gated by construction.** The workflow never runs `gh pr merge`, never touches deploy, and never runs `gh pr close`. Its only two side effects are (a) opening a review PR and (b) posting a nudge comment. Every outcome waits on a human, per Phase 4's "risk gate: deploy stays human".

## Interfaces

### The workflow (the only new contract)

`on`: `schedule` (`0 6 * * 1`) + `workflow_dispatch`. No `pull_request`/`push` triggers — the workflow runs on `main` and reads the whole repo state via the API, not a checkout trigger.

### Token & permissions posture

The workflow authenticates as `${{ github.token }}` — the run-scoped `GITHUB_TOKEN`, not a PAT and not an operator secret. Least-privilege, split per job:

```yaml
permissions:
  contents: read            # top-level default: read-only

jobs:
  dep-bump:
    permissions:
      contents: write       # push the bump branch
      pull-requests: write  # gh pr create + search open PRs
  stale-triage:
    permissions:
      pull-requests: read   # gh pr list / gh pr view
      issues: write         # gh pr comment (issues-comment endpoint)
```

`contents: write` — the largest grant — is confined to `dep-bump` and never touches `main` (the branch is a `chore/deps-weekly` side branch). `stale-triage` has **no** write access to contents. No `actions: write`, no `deployments: write`, no `secrets` needed.

### Artifact contracts (the idempotency anchors)

| Job | Artifact | Fixed, stable identifier |
|---|---|---|
| dep-bump | PR, branch `chore/deps-weekly` | title `chore(deps): weekly dependency bump`, author `github-actions[bot]` |
| stale-triage | comment | marker line `🤖 stale-triage <ISO-week>` (e.g. `2026-W38`), author `github-actions[bot]` |

### Nothing else changes

No new API route, no server change, no new secret, no new ADR, no `packages/*` diff. The engine and its primitives are untouched.

## Job 1 — dependency bump

**Idempotency mechanism.** A **fixed branch + fixed title latch**. The branch name is `chore/deps-weekly` (force-pushed each run), and the PR title is `chore(deps): weekly dependency bump`. The guard runs *before* any work:

```
gh pr list --state open --json number,title,headRefName,author \
  --jq '.[] | select(.title == "chore(deps): weekly dependency bump" and .headRefName == "chore/deps-weekly")'
```

If a matching open PR exists, the job exits with "dependency bump already open — awaiting review" and does nothing. Consequence (intended, not a bug): **at most one bump PR is ever open at a time** — if last week's bump is still unmerged, this week's run skips rather than piling up a second PR. The operator merges or closes the outstanding PR before the next bump appears.

**Race window.** Between the guard check and `gh pr create` a concurrent run could both see "no PR". Three layers close it: (1) `concurrency: maintenance` serializes schedule vs dispatch; (2) the second `gh pr create` from the same head branch fails ("a pull request already exists for these branches"), which the script treats as success-not-error; (3) the title/branch latch is deterministic, so any later run re-detects it.

**Scope & policy.** Detection is `pnpm outdated --recursive --format json` across the whole pnpm workspace (root + `packages/*`), which reports **direct** `dependencies`/`devDependencies` — not transitive deps. The apply step is `pnpm update --recursive` (range-honoring): it bumps **patch/minor within the declared `^`/`~` ranges**, i.e. a lockfile-only change in the normal case, and never rewrites manifest ranges. **Majors and pre-releases are never auto-applied** — they are detected by `pnpm outdated` but only listed in the PR body under "manual upgrades to consider" for the human. There is no `--latest`, no `--interactive`, no transitive-only surgery.

**"Nothing to do" no-op.** `pnpm outdated` exits 0 when everything is current; the script captures the JSON with `|| true` and, if the JSON is empty or exit 0, prints `nothing to do` and exits 0. If the range-honoring update produces no lockfile diff (all drift was majors only), the script also exits clean without a PR. No empty PRs.

**"Too large to open blindly" — who decides?** The human, at review. There is no automatic size cutoff: the PR *is* the gate, and its own CI (`pnpm typecheck`/`pnpm test`) is the first signal if a bump breaks something. Majors are kept out of the auto-apply, so the blindly-opened surface is bounded to patch/minor bumps.

**Flow.** checkout → setup node/pnpm → `pnpm install --frozen-lockfile` → detect (`pnpm outdated --recursive --format json`) → if empty, exit 0 → latch check → `pnpm update --recursive` → `git add pnpm-lock.yaml` (+ any touched manifests) → commit as `github-actions[bot]` → force-push `chore/deps-weekly` → `gh pr create --base main --head chore/deps-weekly --title "chore(deps): weekly dependency bump"` with a body containing the `pnpm outdated` output.

## Job 2 — stale-PR triage

**Precise "stale" definition.** An open PR is stale when its **last human activity is older than 7 days (168 hours)**, where

```
last_human_activity = max(
  PR.created_at,
  last commit pushed to the head branch,
  last comment authored by a human,
  last review authored by a human
)
```

"Human" excludes bots — `github-actions[bot]`, `dependabot[bot]`, and any actor with `type: Bot`. `updated_at` is **not** used: it is bumped by the bot's own nudge comment, CI status events, and label changes, so it would keep a PR "fresh" forever. Excluding the bot's own comments is exactly what lets the nudge fire again next week without resetting the clock.

**Idempotency mechanism.** A **weekly marker comment**, mirroring the `pipeline-trigger` marker-comment latch but keyed by ISO week. The comment body is fixed and deterministic:

```
🤖 stale-triage 2026-W38

This PR has had no human activity (commit/comment/review) for over 7 days.
Please review and merge it, or close it deliberately. No action from me —
I only comment, never merge or close.
```

Before commenting, the job reads each candidate PR's comments and skips any PR that already carries a bot-authored comment containing `stale-triage <current-week>`. Result: **at most one triage comment per PR per week**; a PR that stays stale across weeks gets one comment each week (each with a distinct week marker), which is the intended steady nudge, not a flood.

**Race window.** The check→comment gap inside one job is closed by `concurrency: maintenance` (no concurrent run can interleave), and the marker is deterministic — a duplicate would carry the same week string and be visible immediately. Within a single run each PR is visited exactly once.

**Flow.** `gh pr list --state open --json number,title` → for each, compute `last_human_activity` from `gh pr view --json createdAt,commits,comments,reviews` (author-filtered) → if fresh, skip → if the current-week marker is already present in bot comments, skip → else post the nudge comment. Zero stale PRs ⇒ exit 0 with `nothing to do`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Schedule + dispatch overlap double-fires a job | `concurrency: group: maintenance` serializes; latch re-check makes the loser a no-op |
| Duplicate bump PR (race in the check→create window) | Latch + concurrency + `gh pr create`'s duplicate-branch error treated as already-done |
| Duplicate triage comment | Weekly marker comment is deterministic; only one visit per PR per run |
| Nudge keeps a PR "fresh" forever | Stale signal is *human* activity only; bot comments are author-filtered out |
| `GITHUB_TOKEN` too broad | Least-privilege per-job permissions; `contents: write` confined to `dep-bump`, never touches `main` |
| A bad patch/minor bump merges silently | The bump PR runs full CI and is human-merged; majors are never auto-applied |
| `pnpm outdated` non-zero exit kills the job | Captured with `|| true`; parsed JSON decides, not the exit code |
| Drift from `pipeline-trigger`'s operator-auth model | Deliberate: no agent session ⇒ no operator secrets needed; document this contrast in the workflow comments |
| Boundary drift into the engine | Schedule stays a `.github/workflows` composition file; any engine-side scheduler would need a boundary ADR (see below) |

## ADR pointers

**No new ADR is required.** This is composition (a Schedule) outside the engine, consistent with the [domain boundary](/product/goals/boundaries.md), [ADR 005](/adrs/005-agent-tool-strategy.md)'s inline-tool posture, and the `pipeline-trigger` precedent. It touches no primitive, adds no route, and stores no state in the server. If the change had instead been "engine-native scheduling" (in-core cron/executor), that would be a scope deviation requiring an ADR amending the boundary — the same line drawn in the [engine-native scheduler design](/product/designs/alt-daj9-engine-native-scheduler-design.md). This note does not cross it.

## Minimal change set

- `.github/workflows/maintenance.yml` — new workflow (the entire change).
- `docs/knowledge/product/designs/scheduled-maintenance-design.md` — this note.
- `docs/knowledge/product/designs/index.md` — index entry.

No `packages/*` changes, no API route, no new secret, no new ADR, no engine diff.

## Feature note open questions — resolution summary

- **Idempotency (dep-bump):** fixed branch `chore/deps-weekly` + fixed title latch; at most one open bump PR ever; race closed by `concurrency` + duplicate-branch error.
- **Idempotency (stale-triage):** weekly marker comment `🤖 stale-triage <ISO-week>`; one comment per PR per week.
- **Stale definition:** open PR with `last_human_activity` > 7 days (168h), where human activity = PR create / commits / human comments / human reviews; bot comments and `updated_at` excluded.
- **Dep-bump scope & policy:** `pnpm outdated --recursive` detects, `pnpm update --recursive` applies patch/minor within declared ranges (lockfile-only); majors listed, never auto-applied; empty diff ⇒ clean `nothing to do` exit.
- **Runner vs engine:** plain script steps on the GHA runner, no agent session, no loopback.
- **Dependency posture:** inline scripts + the three `ci.yml`-pinned setup actions; no third-party maintenance actions.
- **Concurrency:** `concurrency: group: maintenance, cancel-in-progress: false`.
