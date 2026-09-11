---
type: Design
title: Scheduled maintenance
description: One weekly `maintenance.yml` workflow with two independent, idempotent jobs — a dependency-bump PR and a stale-PR triage comment — both human-gated and strict no-ops when there is nothing to do.
status: draft
tags: [scheduled, cron, github-actions, maintenance, dogfooding, trust-ladder, design]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-11T18:50:56Z }
sources:
  - id: feature
    resource: /product/features/scheduled-maintenance.md
    title: Scheduled maintenance — Feature note (issue #87)
  - id: engine
    resource: /engine.md
    title: Agent Land engine — "Schedules … cron or triggers … External."
  - id: dogfooding
    resource: /dogfooding.md
    title: Dogfooding — Phase 4 deliverable, Phase 5 gate
  - id: adr-017
    resource: /adrs/017-product-layer-okf-memory.md
    title: ADR-017 — product layer on OKF memory, pipeline outside the engine
  - id: pipeline-trigger
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger — the already-shipped cron counterpart
  - id: ci
    resource: ../../../.github/workflows/ci.yml
    title: CI — `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`
---

# Scheduled maintenance — design

This note pins down the single `maintenance.yml` workflow for [the Feature note](/product/features/scheduled-maintenance.md): the trigger shape, the two jobs, the idempotency mechanism, the "idle > 7 days" predicate, lockfile regeneration, the token permission scope, and failure semantics. It answers all seven open questions from the Feature note; none are deferred.

## Approach

Add **one** workflow file, `.github/workflows/maintenance.yml`, with a weekly `schedule` cron and `workflow_dispatch`, running **two independent jobs** on the default branch (`main`):

1. **`dep-bump`** — detect outdated workspace dependencies with `pnpm outdated -r`, update the in-range subset so `pnpm-lock.yaml` is regenerated, verify the tree is green exactly as CI does, and open at most one `chore(deps): weekly dependency bump` PR per week.
2. **`stale-pr-triage`** — find open PRs with no activity for more than 7 days and post at most one nudge comment per PR per week.

The workflow is pure composition — `pnpm` and `gh` running in the Actions runner. It changes **no engine primitive**, adds no code, no connector, no provider, no mount, no secret. Everything it emits is a PR or a comment, and it never merges, deploys, or closes anything[^engine][^dogfooding][^adr-017].

### One shared week window

Both jobs key their idempotency to a single definition of "per week": the **ISO week, Monday-based, computed in UTC** — `date -u +%G-W%V`, e.g. `2026-W37`. The cron is `0 9 * * 1` (Monday 09:00 UTC), so the schedule boundary and the week key align; a `workflow_dispatch` at any other time computes the same current key and is therefore idempotent against the scheduled run in that week.

## The workflow shape

```yaml
name: Maintenance

on:
  schedule:
    - cron: "0 9 * * 1" # weekly — Monday 09:00 UTC
  workflow_dispatch:

permissions:
  contents: write        # push the bump branch
  pull-requests: write   # open the bump PR
  issues: write          # post triage comments on PRs (issue comments)

env:
  REPO: ${{ github.repository }}

jobs:
  dep-bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm

      # Mirror CI's toolchain so the pre-PR verify is faithful (ci.yml installs these too).
      - name: Install sops and age (mirror CI)
        run: |
          curl -fsSL "https://github.com/FiloSottile/age/releases/download/v1.2.1/age-v1.2.1-linux-amd64.tar.gz" \
            | sudo tar -xz -C /usr/local/bin --strip-components=1 age/age age/age-keygen
          curl -fsSL "https://github.com/getsops/sops/releases/download/v3.9.4/sops-v3.9.4.linux.amd64" \
            -o /tmp/sops
          sudo chmod +x /tmp/sops && sudo mv /tmp/sops /usr/local/bin/sops

      - name: Weekly dependency bump (idempotent)
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          WEEK="$(date -u +%G-W%V)"
          BRANCH="chore/deps-weekly-${WEEK}"
          TITLE="chore(deps): weekly dependency bump"

          # Idempotency — skip if an open bump PR exists, or the week's branch is still around.
          open_bump="$(gh pr list --repo "$REPO" --state open --json title \
            --jq '[.[].title | select(. == "chore(deps): weekly dependency bump")] | length')"
          if [ "$open_bump" -gt 0 ]; then
            echo "an open bump PR already exists; nothing to do"
            exit 0
          fi
          if git ls-remote --exit-code --heads origin "refs/heads/${BRANCH}" >/dev/null 2>&1; then
            echo "branch ${BRANCH} already exists; nothing to do"
            exit 0
          fi

          # Detect. pnpm outdated: 0 = up to date, 1 = outdated found, other = error.
          set +e
          outdated="$(pnpm outdated -r)"
          rc=$?
          set -e
          case "$rc" in
            0) echo "no outdated dependencies; nothing to do"; exit 0 ;;
            1) : ;; # outdated packages found — proceed
            *) echo "pnpm outdated failed (exit $rc); failing loudly"; exit 1 ;;
          esac

          # Update the in-range subset and rewrite the lockfile. No --latest: major
          # bumps stay human decisions. Then verify exactly as CI does.
          pnpm update -r
          pnpm install --frozen-lockfile
          if [ -z "$(git status --porcelain)" ]; then
            echo "outdated packages are out-of-range; no in-range updates; nothing to do"
            exit 0
          fi
          pnpm typecheck
          pnpm test

          # Open the human-gated PR.
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH"
          git add -A
          git commit -m "chore(deps): weekly dependency bump (${WEEK})"
          git push -u origin "$BRANCH"
          {
            echo "Weekly dependency bump — human-gated: review and merge. This workflow never merges, deploys, or closes anything."
            echo
            echo "## Outdated packages (pnpm outdated -r)"
            echo
            echo '```'
            printf '%s\n' "$outdated"
            echo '```'
          } > /tmp/pr-body.md
          gh pr create --repo "$REPO" --title "$TITLE" --base main --head "$BRANCH" --body-file /tmp/pr-body.md

  stale-pr-triage:
    runs-on: ubuntu-latest
    steps:
      - name: Stale-PR triage (idempotent)
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          WEEK="$(date -u +%G-W%V)"
          MARKER="<!-- agent-land:stale-triage:${WEEK} -->"
          CUTOFF="$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)"

          # Idle = open PR with updatedAt strictly older than 7 days (UTC).
          ids="$(gh pr list --repo "$REPO" --state open --json number,updatedAt \
            --jq "[.[] | select(.updatedAt < \"${CUTOFF}\") | .number] | .[]")"

          if [ -z "$ids" ]; then
            echo "no open PRs idle for more than 7 days; nothing to do"
            exit 0
          fi

          for n in $ids; do
            if gh pr view "$n" --repo "$REPO" --json comments --jq '.comments[].body' | grep -qF "$MARKER"; then
              echo "PR #$n already triaged this week ($WEEK); skipping"
              continue
            fi
            gh pr comment "$n" --repo "$REPO" --body "${MARKER}
          This PR has had no commit or comment activity for more than 7 days. Please review and either continue it or close it.
          (automated stale-PR triage — at most once per PR per week.)"
            echo "commented on PR #$n"
          done
```

## Interfaces

- **New file** — `.github/workflows/maintenance.yml` (the only artifact). No package, code, env, or secret changes; `ci.yml`, `deploy.yml`, and `pipeline-trigger.yml` are untouched.
- **Token** — both jobs use the built-in `${{ github.token }}` (`GH_TOKEN`), so the workflow-level `permissions:` block is authoritative. No PAT, no deploy SSH key (that key lives only in `deploy.yml` and is never referenced here).
- **Machine-readable signals** (the "interfaces" other tooling/humans rely on):
  - PR title `chore(deps): weekly dependency bump` (exact string, used as the idempotency key).
  - Branch `chore/deps-weekly-<G>-W<V>` (week-keyed idempotency token that persists even after a PR is closed without deleting the branch).
  - Triage marker comment `<!-- agent-land:stale-triage:<G>-W<V> -->` — an HTML comment, invisible when rendered but greppable by the next run.
- **No new secrets** — the workflow needs nothing beyond the auto-token.

## Open questions — answered

1. **Idempotency mechanism per job.** *Dep bump:* skip if (a) any **open PR has the exact title**, or (b) the **remote branch `chore/deps-weekly-<WEEK>` already exists** (covers "closed but branch not deleted"). Both are visible via `gh pr list` / `git ls-remote` — no new persisted state. *Triage:* skip if the PR's comments already contain the **week-keyed marker** `<!-- agent-land:stale-triage:<WEEK> -->`. Because the marker is keyed to the ISO week, a *different* week is a new window (re-nudge allowed), while a re-run in the same week is a no-op. The marker is itself a comment, so it counts as activity (see Q2).
2. **Definition of "idle for more than 7 days".** An open PR is idle iff `gh pr list --state open --json number,updatedAt` reports `updatedAt` strictly older than `now - 7 days` (UTC ISO-8601 string comparison). `updatedAt` is bumped by commits, comments, reviews, and label edits — a conservative superset of "no commit/comment", so the bot never nudges something that saw *any* recent activity. Re-nudging: allowed each subsequent ISO week (marker is week-keyed); in practice a fully dead PR is re-nudged roughly every other week because the bot's own comment bumps `updatedAt`. That satisfies "at most once per PR per week" and avoids weekly nag spam.
3. **Scope of `pnpm outdated` and a green PR.** `pnpm outdated -r` (recursive, all workspace packages). The bump uses `pnpm update -r` — **in-range only, deliberately no `--latest`**, so major jumps (e.g. zod 3→4, typescript 5→7) stay human decisions. `pnpm update -r` regenerates `pnpm-lock.yaml`; the job then runs `pnpm install --frozen-lockfile` (asserting lockfile/manifest consistency exactly as CI does) followed by `pnpm typecheck` and `pnpm test` **before** opening the PR. A post-update `git status --porcelain` guard ensures "no in-range updates ⇒ no diff ⇒ no empty PR". Result: the bump PR is green under CI's `--frozen-lockfile` by construction.
4. **Branch, commit, and permissions.** Branch `chore/deps-weekly-<G>-W<V>`; commit `chore(deps): weekly dependency bump (<G>-W<V>)` authored as `github-actions[bot]`; PR title the exact `chore(deps): weekly dependency bump`; PR body carries the `pnpm outdated -r` table plus the human-gated notice. Permissions are the least-privilege set **`contents: write` + `pull-requests: write` + `issues: write` only** (see Q5).
5. **No-merge / no-deploy / no-close enforcement.** **Deploy is structurally impossible**: the workflow grants no `deployments:` or `actions:` scope and references no deploy credential or step. **Merge/close is denied by construction, not by permission**: GitHub has no finer-grained scope than `pull-requests: write` for "open a PR but not merge it", so with `pull-requests: write` the token *could* in principle merge — the guarantee is that the workflow contains **no** `gh pr merge`, `gh pr close`, or `gh api … merge/close/delete` step, and never will; PR review on this repo gates any future edit. This is the honest residual, documented rather than papered over.
6. **Failure semantics.** **Fail loudly.** Every run step is `set -euo pipefail`. A transient `pnpm`/registry/`gh` error exits non-zero → red run (intentional, per the trust-ladder's caution: a broken maintenance run should be noisy, never silently skipped). The only exit-0 paths are the legitimate empty states — no outdated deps, no post-update diff, no idle PRs, or an idempotency skip — each logged as "nothing to do". The two jobs are independent (parallel), so one failing does not suppress the other.
7. **Week window.** One shared definition for both jobs: **ISO week (`%G-W%V`), Monday-based, UTC**. The cron boundary (Monday 09:00 UTC) and the week key align; `workflow_dispatch` mid-week computes the same key and is idempotent against the scheduled run.

## Risks & mitigations

- **Bump PR turns CI red** → mitigated by running `pnpm install --frozen-lockfile` + `pnpm typecheck` + `pnpm test` in-workflow before opening; on failure the run aborts with no PR and exits red. Residual: CI re-runs the same checks and could drift on a later dependency resolution change — rare, and human review is the backstop.
- **Unsolicited breaking/major bumps** → `pnpm update -r` is in-range only; majors are surfaced in the PR body (from `pnpm outdated -r`) but not applied.
- **Duplicate PR or comment** → open-PR-title + week-keyed-branch guard for the PR; week-keyed marker comment for triage.
- **A still-open bump PR blocks future bumps** → intentional and desirable: the next run skips while one is open, and the stale-PR job will nudge that very PR; once merged/closed, bumping resumes.
- **The bot's own nudge resetting the idle clock** → accepted: the nudge counts as activity, which naturally spaces re-nudges to ~biweekly and prevents nag spam; still "at most once per PR per week".
- **Token could technically merge** → no merge/close step exists; deploy is permission-denied; the workflow is reviewed like any other change. Not a permission-level guarantee for merge/close — documented, not hidden.
- **Timezone/clock drift in the idle comparison** → both timestamps are UTC ISO-8601 strings (`gh` output and `date -u`), so lexicographic comparison is unambiguous.

## ADR pointers

No new ADR. This is a composition-layer **schedule** — "Schedules … cron or triggers that call the API. External." in [the engine](/engine.md) — and product-layer work already governed by [ADR-017](/adrs/017-product-layer-okf-memory.md) (OKF memory + pipeline outside the engine). A new ADR would only be warranted if the team later wants to encode the "no merge/deploy/close" guarantee as standing policy; out of scope here.

## Minimal change set

- `.github/workflows/maintenance.yml` — the single new workflow, containing both jobs as inline `bash`.
- No package, code, env, config, or secret changes; `ci.yml`, `deploy.yml`, `pipeline-trigger.yml` untouched.
- End-to-end verification is a `workflow_dispatch` run (per the acceptance criteria), not an additional file.

[^engine]: [Agent Land engine](/engine.md) — six primitives; schedules are external composition.
[^dogfooding]: [Dogfooding](/dogfooding.md) — Phase 4 deliverable; Phase 5 is gated on this running clean.
[^adr-017]: [ADR-017](/adrs/017-product-layer-okf-memory.md) — product knowledge as OKF, pipeline outside the engine.
[^pipeline-trigger]: [Scheduled pipeline trigger](/learnings/scheduled-pipeline-trigger.md) — the shipped cron counterpart whose marker-comment idempotency pattern this design generalizes.
[^ci]: [CI workflow](../../../.github/workflows/ci.yml) — `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`.
