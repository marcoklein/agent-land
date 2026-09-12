---
type: Design
title: Weekly maintenance — scheduled dep-bump + stale-PR triage
description: A weekly + workflow_dispatch GitHub Actions workflow of two plain-bash jobs that opens at most one chore(deps) bump PR and nudges at most once per week each PR idle >7 days — human-gated, idempotent by branch and marker conventions.
status: draft
tags: [design, maintenance, cron, github-actions, dependencies, triage, dogfooding, trust-ladder]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-12T05:33:34Z }
sources:
  - id: feature
    resource: /product/features/weekly-maintenance.md
    title: Weekly maintenance — Feature note (outcome gate)
  - id: trigger
    resource: ../../../.github/workflows/pipeline-trigger.yml
    title: Pipeline trigger — the existing cron this is the generic counterpart to
  - id: trigger-learning
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger — marker-comment idempotency and its known spawn race
  - id: ci
    resource: ../../../.github/workflows/ci.yml
    title: CI workflow — the check suite the dep-bump job mirrors inline
  - id: dogfooding
    resource: /dogfooding.md
    title: Dogfooding strategy — Phase 4 and the trust ladder
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary — composition outside the engine
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the composition layer (Schedules, Workflows)
  - id: adr-017
    resource: /adrs/017-product-layer-okf-memory.md
    title: Product layer on OKF memory — pipeline outside the engine
  - id: adr-004
    resource: /adrs/004-connector-model.md
    title: Connector model — sessions use connectors, composition workflows use github.token
  - id: adr-005
    resource: /adrs/005-agent-tool-strategy.md
    title: Pre-baked tools — gh/curl/jq/git are the assumed toolchain
  - id: adr-011
    resource: /adrs/011-kill-switch.md
    title: Per-run kill switch — why sessions carry risk envelopes plain bash does not
---

# Weekly maintenance — design

This note answers the design-gate questions from the [Feature note](/product/features/weekly-maintenance.md) for issue #87 and pins the decisions the implementation will follow. The fit-check already passed[^feature][^boundary]: this is pure *composition outside the engine* — a [Schedule](/engine.md) (weekly cron + `workflow_dispatch`) driving a [Workflow](/engine.md) of deterministic `gh`/`pnpm` steps — and it is the dogfooding Phase 4 deliverable ("a cron workflow that opens a maintenance PR every week without being asked")[^dogfooding]. The design is the generic-cron counterpart to the already-shipped [pipeline trigger](../../../.github/workflows/pipeline-trigger.yml), which starts the product pipeline; this one performs the recurring chores directly[^trigger][^trigger-learning].

## Approach

One new workflow file, `.github/workflows/maintenance.yml`, triggered by `schedule: "0 7 * * 1"` (Monday 07:00 UTC) **and** `workflow_dispatch`. It has two independent jobs — a failure in one must not block the other.

**Job 1 — `dep-bump`.** Checkout + `pnpm/action-setup`, then:

1. `pnpm update -r` — bump every workspace package to the newest version *within its declared range*. This rewrites `pnpm-lock.yaml` (and `package.json` only if a range itself moves; in-range bumps do not touch manifest ranges).
2. If `git diff` is empty after the update, nothing was bumpable in-range: log "nothing to do" and exit 0 — no branch, no PR.
3. Otherwise run the repo's own check suite inline (mirror `ci.yml`: install `sops`/`age`, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`) — this is the green gate (see *Leaving it green*, below).
4. If green: commit as `github-actions[bot]`, push head `chore/deps/weekly-dependency-bump`, and open PR `chore(deps): weekly dependency bump` **only if** `gh pr list --head chore/deps/weekly-dependency-bump --state open` is empty.
5. If checks fail: do **not** open a PR; exit non-zero so the failure is loud in the Actions log.

`pnpm outdated -r --format json` runs once, tolerating its non-zero exit (`|| true`), purely to populate the PR body's "still outdated / manual bump candidates" section — majors and out-of-range bumps are **never** auto-applied; they are listed for human decision.

**Job 2 — `stale-triage`.** `gh pr list --state open --json number,headRefName,author`, then per PR:

1. Skip the dep-bump PR (`headRefName == chore/deps/weekly-dependency-bump`) so the maintenance workflow never nags its own artifact.
2. Compute last *human* activity = max(last commit `committedDate`, last comment `createdAt` among comments **not** containing the triage marker).
3. If that timestamp is older than 7 days **and** the PR's comments do not already contain this ISO week's marker, post a nudge comment ending with `<!-- weekly-stale-triage: <ISO-WEEK> -->` (e.g. `2026-W37`).
4. Otherwise no-op.

**Human-gated by construction.** Neither job has a merge, deploy, or close step. `permissions` are exactly `contents: write, pull-requests: write, issues: write` — never `deployments`, never `admin`, never `actions`. Both jobs set `timeout-minutes` as a coarse analog of the session kill switch (see ADR pointers).

## Interfaces

- **Trigger surface.** `schedule` (cron) and `workflow_dispatch` only. The workflow is the *only* caller of itself; no API consumer invokes it.
- **GitHub surface.** `gh` against `marcoklein/agent-land` using `github.token` (the workflow's ephemeral `GITHUB_TOKEN`), scoped by the `permissions` block above. This is deliberately **not** a connector: connectors and their sealed secrets are a *session* concept ([ADR-004](/adrs/004-connector-model.md)); a composition workflow outside the engine has no session, so it uses GitHub's own auto-provisioned token instead.
- **pnpm CLI.** `pnpm update -r` (the bump), `pnpm outdated -r --format json` (advisory report only), and the ci.yml check suite. Toolchain availability follows [ADR-005](/adrs/005-agent-tool-strategy.md): `gh`/`curl`/`jq`/`git` are pre-baked on `ubuntu-latest`; `pnpm` comes from `pnpm/action-setup`.
- **Cross-run idempotency contracts (the real "interface").**
  - Dep-bump: the fixed head branch `chore/deps/weekly-dependency-bump` is the latch. `gh pr list --head` detects an existing open PR; at most one such PR is ever open (strictly stronger than "one per week"). Re-dispatch in the same week no-ops.
  - Stale-triage: the comment footer `<!-- weekly-stale-triage: <ISO-WEEK> -->` is the latch, encoding the week so "at most once per PR per week" is testable and a re-dispatch no-ops. This mirrors the START/DONE marker pattern the pipeline trigger established[^trigger][^trigger-learning].
- **Commit identity.** `github-actions[bot]` `<41898282+github-actions[bot]@users.noreply.github.com>`, set explicitly via `git config` in the job. The operator's `GIT_USER_NAME`/`GIT_USER_EMAIL` are session-level env injection and do not apply to a non-session workflow; bot attribution keeps automated commits distinguishable from human/agent-authored ones.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| The bump PR's own CI never runs. GitHub suppresses workflow runs triggered by `GITHUB_TOKEN`-created events, so the PR opened by `github.token` will **not** auto-run `ci.yml`. | The dep-bump job runs the full check suite **inline before pushing** — the maintenance run itself is the green gate, and the PR body records it. If a human wants PR-level CI status, they push an empty commit (or we later swap in a scoped fine-grained PAT; deliberately deferred for least-privilege). |
| `pnpm update -r` produces no diff but `pnpm outdated` still reports out-of-range majors. | Gate on the diff, not on `pnpm outdated`. No diff ⇒ no PR (nothing bumpable in-range); majors are listed in the PR body as manual candidates and never auto-applied, so a breaking bump never rides along silently. |
| `pnpm outdated` exits non-zero when anything is outdated, which would abort `set -euo pipefail`. | `pnpm outdated … || true`; it is advisory-only. The actual gate is `git diff` after `pnpm update -r`, which has no such exit-code trap. |
| Duplicate PRs / duplicate nudges on re-dispatch or overlapping runs. | Fixed branch latch (dep-bump) + ISO-week marker latch (triage). A second run in the same week detects the latch and no-ops. |
| The triage bot resets its own "idle" timer, or nags its own bump PR. | Bot comments carrying the marker are excluded from the last-activity computation, and the dep-bump PR is skipped by head branch. A PR with no human activity keeps getting one nudge per week, which is the intended behavior. |
| A stale-PR run reads PR data while it mutates (transient gh/token failures mid-loop). | Fail-fast per item but continue others: a transient read failure on one PR is logged and skipped rather than risking a duplicate comment; the whole job fails only if listing itself fails. |
| The workflow gains authority over time (future edits add merge/deploy). | The `permissions` block is the enforceable ceiling and the acceptance criterion "never `deployments`, never `admin`" is review-visible in one place. Phase 5 stays locked until Phase 4 runs clean for weeks[^dogfooding]. |
| Unbounded job runtime. | `timeout-minutes` on both jobs — the coarse analog of the per-run kill switch ([ADR-011](/adrs/011-kill-switch.md)) for code that is not a session. |

## ADR pointers

- **ADR-017 — Product layer on OKF memory, pipeline outside the engine.** This workflow is composition outside the engine by construction; no primitive is added or changed, matching the boundary fit-check[^adr-017][^boundary].
- **ADR-004 — Connector model.** The workflow uses `github.token`, not a connector: sealed secrets and connector resolution are session capabilities, and this is not a session[^adr-004]. (Contrast the pipeline trigger, which *spawns* a session and therefore resolves a connector + operator auth.)
- **ADR-005 — Pre-baked tools.** The jobs rely on exactly the pre-baked toolchain (`gh`, `git`, `jq`) plus `pnpm/action-setup`, no runtime installs[^adr-005].
- **ADR-011 — Per-run kill switch.** Cited negatively: because these jobs are plain bash, they have no session and thus no `KillSwitch`; `timeout-minutes` is the substitute, and it is sufficient because the jobs do bounded, deterministic work[^adr-011]. This is also the core argument for the session-vs-script decision below.

## Open questions resolved

1. **Session vs. script → plain bash.** The jobs run as direct `gh`/`pnpm` steps, not spawned agent-land sessions. Dogfooding rule 1 ("ship through the tool") is honored at the layer where judgment happens — this design and the workflow file are produced *by* agent-land sessions through the pipeline — but the *runtime* work is deterministic CRUD + git, with no judgment to delegate. A session would add a Mount/session lifecycle, the pipeline trigger's known spawn→marker race[^trigger-learning], and a kill-switch envelope for no benefit. Sessions stay reserved for judgment work (orchestration, planning, review).
2. **Dep-bump idempotency → fixed head branch.** `chore/deps/weekly-dependency-bump` via `gh pr list --head --state open`. Simplest, survives re-dispatch, and gives at-most-one-open-PR (stronger than the acceptance criterion's "one per week").
3. **Triage idempotency → ISO-week marker footer.** `<!-- weekly-stale-triage: <ISO-WEEK> -->`, mirroring the pipeline trigger's marker convention. The week in the marker makes "once per PR per week" testable.
4. **"Idle" → last *human* activity > 7 days.** Idle = `max(last commit date, last non-bot comment date)` older than 7 days; the bot's own marker comments are excluded so a prior nudge does not reset the timer. "Any comment" is treated as human activity; only the triage bot's marker comments are excluded.
5. **`pnpm outdated` exit code → advisory only.** `|| true`; the gate is `git diff` after `pnpm update -r`.
6. **Leaving it green → inline check suite, not PR CI.** The workflow runs `pnpm install --frozen-lockfile` + `pnpm typecheck` + `pnpm test` (with sops/age bootstrap) before pushing, because `github.token`-created PRs do not auto-trigger `ci.yml`. Breaking majors are never auto-applied, so a green inline run is a meaningful gate.
7. **Cadence & job split → Monday 07:00 UTC, two jobs.** `0 7 * * 1` + `workflow_dispatch`; two independent jobs so a triage failure never blocks the bump and vice versa.
8. **Committer identity → `github-actions[bot]`.** Explicit bot identity, not the operator's `GIT_USER_NAME`/`GIT_USER_EMAIL`.

Nothing is deferred; every open question has a decision above. The only explicitly *left for later* item is the optional future swap to a scoped fine-grained PAT if PR-level CI status on the bump PR is ever wanted (noted in Risks).

## Minimal change set

- `.github/workflows/maintenance.yml` — the single new workflow file (trigger, permissions, `dep-bump` and `stale-triage` jobs). No engine, CLI, or server change; no new secrets; no new connector.

[^feature]: [Weekly maintenance — Feature note](/product/features/weekly-maintenance.md)
[^trigger]: [Pipeline trigger workflow](../../../.github/workflows/pipeline-trigger.yml)
[^trigger-learning]: [Scheduled pipeline trigger](/learnings/scheduled-pipeline-trigger.md)
[^ci]: [CI workflow](../../../.github/workflows/ci.yml)
[^dogfooding]: [Dogfooding strategy](/dogfooding.md)
[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md)
[^engine]: [Agent Land engine](/engine.md)
[^adr-017]: [ADR-017 — Product layer on OKF memory](/adrs/017-product-layer-okf-memory.md)
[^adr-004]: [ADR-004 — Connector model](/adrs/004-connector-model.md)
[^adr-005]: [ADR-005 — Pre-baked tools](/adrs/005-agent-tool-strategy.md)
[^adr-011]: [ADR-011 — Per-run kill switch](/adrs/011-kill-switch.md)
