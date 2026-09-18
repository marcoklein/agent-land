---
type: Design
title: Scheduled maintenance — weekly dep-bump + stale-PR triage
description: Design for a weekly GitHub Actions workflow implementing idempotent dependency-bump and stale-PR triage jobs, both human-gated and producing no output when there is nothing to do.
status: draft
tags: [playbook, maintenance, cron, dogfooding, phase-4]
generated: { by: opencode/claude, at: 2026-09-18T12:00:00Z }
sources:
  - id: feature-note
    resource: /product/features/scheduled-maintenance.md
    title: Feature note for issue #87
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
  - id: pipeline-trigger
    resource: .github/workflows/pipeline-trigger.yml
    title: Pipeline trigger workflow (existing reference)
  - id: trust-ladder
    resource: /playbook/dogfooding.md#trust-ladder
    title: Trust ladder and Phase 4/5 constraints
---

# Scheduled maintenance design

This design answers the open questions from issue #87, defines the execution strategy for the maintenance workflow, and specifies the contracts and minimal change set.

## Approach

The maintenance workflow runs as a **standalone GitHub Actions workflow** (bash steps + standard GitHub CLI tools), not as loopback sessions. This is the simplest, most robust approach:

- **No platform dependency.** Bash steps + `pnpm` + `gh` do not require the agent-land platform to be running, reducing failure modes and attack surface.
- **Mirrors the pattern.** `pipeline-trigger.yml` spawns orchestrator sessions for high-value decisions (full pipeline runs); maintenance jobs are lower-risk, read-and-propose actions that benefit from being self-contained.
- **Clear responsibilities.** Platform orchestrates complex workflows; the workflow orchestrates simple, deterministic tasks.

**Two jobs, both human-gated:**

1. **`job-dep-bump`** — runs `pnpm outdated` to detect stale dependencies. If any exist, opens one `chore(deps): weekly dependency bump` PR per week on branch `maintenance/deps`. If none exist, exits clean ("nothing to do").

2. **`job-stale-pr-triage`** — queries all open PRs using `gh` API, filters to those idle (no commit or comment) for >7 days, and posts at most one triage comment per PR per week asking for attention or closure. If no PRs are stale, exits clean ("nothing to do").

**Idempotency:** Both jobs use a weekly marker latch (keyed on calendar week + workflow name) stored in a commit message or PR label to prevent duplicate outputs in the same week. A second `workflow_dispatch` run is a no-op.

**Nothing destructive:** Neither job merges, deploys, or auto-closes. All outputs (PR or comment) are human-gated.

## Interfaces

### Workflow triggering

**File:** `.github/workflows/maintenance.yml`

**Triggers:**
- `schedule: '0 9 * * 1'` — every Monday 9 AM UTC (aligned with business week)
- `workflow_dispatch` — manual trigger for testing

**Inputs:** None required. Optional: `--workflow_dispatch` with no parameters.

### Environment and secrets

**Required secrets:**
- `GITHUB_TOKEN` (provided by GitHub Actions) — for `gh` CLI and repo API access

**No additional secrets needed** — not using platform API, so `AGENT_LAND_URL` and `AGENT_LAND_BASIC_AUTH` are not required.

### Dep-bump job interface

**Input:** None (reads from workspace `pnpm-lock.yaml` and `package.json`)

**Output:** Creates or does nothing
- If outdated deps exist: Opens a PR with
  - Title: `chore(deps): weekly dependency bump`
  - Branch: `maintenance/deps`
  - Body: lists outdated packages, guidance on review
  - Base: `main`
  - Latch marker in PR body: `<!-- maintenance:dep-bump:YYYY-WXX -->`
- If no outdated deps: Logs "No outdated dependencies found" and exits 0

**CLI invoked:**
```bash
pnpm outdated --json
gh pr create --title "chore(deps): weekly dependency bump" \
  --body "..." --head maintenance/deps --base main
gh pr list --state open --search "head:maintenance/deps" --json number,title
```

### Stale-PR triage job interface

**Input:** None (queries open PRs from this repo)

**Output:** Creates comments or does nothing
- For each open PR idle >7 days and not yet triaged this week:
  - Posts comment: "This PR has been idle for >7 days. Please update, confirm still needed, or close. (Triaged YYYY-WXX)"
  - Latch marker: comment includes `triaged YYYY-WXX` to prevent re-comment in the same week
- If no stale PRs: Logs "No stale PRs found" and exits 0

**CLI invoked:**
```bash
gh pr list --state open --json number,title,updatedAt,comments --repo <repo>
gh pr comment <number> --body "..."
```

**Idle definition:** A PR is idle if the most recent event (commit or comment on that PR) is >7 days old. Draft PRs and PRs with labels `human`, `blocked`, or `phase-5` are excluded from triage.

## Decisions: Answers to open questions

### 1. Execution shape

**Decision:** Bash steps in the workflow, not loopback sessions.

**Rationale:** 
- Maintenance is safe, deterministic, read-and-propose — no need for the full orchestrator.
- Reduces platform dependency; workflow is resilient if the platform is down.
- Mirrors the `pipeline-trigger.yml` pattern: that workflow orchestrates complex decisions via sessions; standalone workflows handle simpler, deterministic tasks.

**If revisited:** If Phase 5 requires platform-level audit trails for all automation, this can be refactored to spawn loopback sessions. For now, the simpler approach wins.

### 2. Dep-bump scope

**Decision:** Bump all outdated workspace dependencies in a single PR.

**Rationale:**
- Simpler idempotency (one PR per week vs. multiple).
- Operator reviews all at once; no decision-making per-package.
- `pnpm install` auto-updates lockfiles; no additional step needed.

**What's bumped:**
- All outdated deps across the entire workspace (root + all packages).
- Both runtime and dev deps.
- Respects semver ranges in `package.json`; lockfile is updated accordingly.
- Does NOT perform major version upgrades (only within semver constraints already in manifests).

### 3. Idle definition edge cases

**Decision:**
- **Idle:** No commit or comment on the PR for >7 days (whichever is newer determines the last event).
- **Excluded:** Draft PRs, PRs with labels `human`, `blocked`, or `phase-5`.

**Rationale:**
- Commits and comments are the clearest signals of activity; ignore CI/bot comments unless the PR author responds.
- Draft PRs are intentionally in-progress; don't nag them.
- Phase 5 PRs are explicitly gated; don't triage until Phase 4 runs clean.
- Human/blocked labels are manual gates applied by the operator.

**Tradeoff:** "No comment" includes bot comments, so a PR with only bot updates still gets triaged. This is intentional — the operator needs to confirm the PR is still wanted.

### 4. Idempotency latch

**Decision:** Store the latch in the **PR/comment body itself** using an HTML comment marker.

**Dep-bump marker (in PR body):**
```html
<!-- maintenance:dep-bump:2026-W38 -->
```

**Stale-PR triage marker (in comment):**
```html
Triaged: 2026-W38 (Monday Sep 15)
```

**How it works:**
1. Before creating/commenting, the job checks for existing PR/comments from the same job in the same week.
2. If found, skip the action (idempotent no-op).
3. If not found, proceed.

**Week definition:** ISO week (W01–W53), stable across runs.

**Why this approach:**
- No external state (no file commit, no label).
- Transparent in the PR/comment history.
- Mirrors the `pipeline-trigger.yml` pattern (marker in comment).

### 5. Failure mode

**Decision:** If a job fails, the entire workflow fails. The operator is notified via GitHub Actions UI + email.

**What triggers a failure:**
- `pnpm outdated` returns error (e.g., corrupted lock file).
- `gh pr create` fails (permissions, network, rate limit).
- PR query fails (network, permissions).
- An uncaught exception in the script.

**No silent retry;** failure surfaces immediately so the operator can investigate and fix the root cause (not sweep it into the next week).

**Phase 5 gate:** A workflow failure blocks Phase 5 deployment; this phase must run cleanly. See [Dogfooding playbook](/playbook/dogfooding.md#phase-5-gated-merge--deploy).

### 6. Secrets

**Decision:** Only `GITHUB_TOKEN` is required. No `AGENT_LAND_URL` or `AGENT_LAND_BASIC_AUTH`.

**Why:**
- The workflow does not spawn platform sessions.
- `GITHUB_TOKEN` is always available in GitHub Actions and has repo read/write scope.
- Future loopback refactoring (if Phase 5 requires it) would add platform secrets then.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| **Dep-bump PR merges without review** | The PR is not auto-merged; GitHub branch protection requires review. Operator must review and merge (or close). |
| **Duplicate PRs or comments in the same week** | Idempotency latch (week marker in PR body / comment) prevents duplicates. A second `workflow_dispatch` run in the same week is a no-op. |
| **Stale-PR triage spams noisy repos with 100+ open PRs** | Query is limited to `--state open`; initial run may post many comments. This is intentional (bring attention to drift) but operator can bulk-close/label if needed. A mitigation: add `--first N` limit (e.g., 20 at a time) to avoid overwhelming a single run. |
| **"Idle >7 days" filters out legitimately blocked PRs** | Excluded PRs with `human`, `blocked`, or `phase-5` labels. Operator can apply these labels to suppress triage. |
| **Workflow fails, Phase 5 is blocked indefinitely** | Operator must investigate and fix (e.g., corrupted lock file). The phase is intentionally blocked until maintenance runs clean — this is the trust ladder. |
| **Maintenance.yml checks out `main` but PR branch is stale** | Both jobs run on a fresh `main` checkout (no base branch cache). Dep-bump creates a new `maintenance/deps` branch each time; stale-PR triage reads live PR data. Risk is minimal. |

## ADR pointers

- **[Trust Ladder](/playbook/dogfooding.md#trust-ladder)** — Phase 4 / Phase 5 gating. This design respects the constraint that Phase 5 (gated merge/deploy) stays blocked until Phase 4 runs clean.
- **Related:** [Pipeline trigger workflow](/playbook/dogfooding.md#the-playbook-inventory) — this design mirrors the orchestration pattern (scheduled cron + human gates).
- **Future ADR (if needed):** If Phase 5 requires platform-level audit trails for all automation, we will need an ADR to justify loopback sessions for maintenance (complexity/robustness tradeoff).

## Minimal change set

**New files:**
- `.github/workflows/maintenance.yml` — the main workflow definition

**Modified files:**
- None (no changes to existing workflows, package.json, or business logic)

**Why minimal:**
- The feature is pure addition (new workflow).
- No changes to the engine, existing jobs, or versioning.
- Workflow is self-contained and can be disabled/tweaked independently.

**Deployment:**
- Merge the design PR to `main`.
- Commit `.github/workflows/maintenance.yml` on the implementation branch.
- The workflow is active immediately upon merge (GitHub Actions detects `.github/workflows/*.yml` changes).

**Testing:**
- Manual `workflow_dispatch` run before scheduling.
- First scheduled run (Monday 9 AM UTC) validates the full cycle.
- Operator can re-run on the same Monday to test idempotency.

## Deferred questions

None — all Feature note open questions are addressed above.

## Implementation priority

1. **Week 1:** Script the `job-dep-bump` job, test locally with `workflow_dispatch`.
2. **Week 2:** Script the `job-stale-pr-triage` job, validate idempotency latches.
3. **Week 3:** Merge design PR, test full workflow on `marcoklein/agent-land`, prepare schedule.
4. **Week 4+:** Run scheduled (Monday 9 AM UTC) and monitor for the first 4 weeks.

Post-implementation, capture operational learnings in `docs/knowledge/learnings/`.
