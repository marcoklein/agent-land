---
type: Design
title: Respond to Review
description: Playbook recipe — one kernel, two entry points — that reads review feedback via gh api, addresses each thread, pushes to the PR head branch, replies once per thread, and re-requests review (recipe-only, zero engine change).
status: draft
tags: [dogfooding, review, github, composition, recipe, orchestration]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-17T14:55:29Z }
sources:
  - { id: dogfooding, resource: /playbook/dogfooding.md, title: "Dogfooding — the agent-land playbook" }
  - { id: mount-design, resource: /product/designs/mount-design.md, title: "Mount design — single-writer invariant" }
  - { id: dynamic-orchestration, resource: /product/designs/dynamic-orchestration-design.md, title: "Dynamic Orchestration design" }
  - { id: policy, resource: agent-image/skills/orchestrator/policy.yaml, title: "Orchestrator policy (stage kinds, budgets)" }
  - { id: plan-schema, resource: agent-image/skills/orchestrator/plan.schema.json, title: "plan.json contract" }
  - { id: plan-mjs, resource: agent-image/skills/orchestrator/plan.mjs, title: "plan.json validator + budget calculator" }
  - { id: dev-playbook, resource: agent-image/skills/dev-playbook/SKILL.md, title: "The development loop recipe" }
  - { id: ticket-loop, resource: /playbook/ticket-loop.md, title: "Ticket loop — the dogfooding heartbeat" }
  - { id: adr-017, resource: /adrs/017-product-layer-okf-memory.md, title: "ADR 017 — product layer on OKF memory" }
  - { id: adr-011, resource: /adrs/011-kill-switch.md, title: "ADR 011 — per-run kill switch" }
---

# Respond to Review
The design for [the Respond to Review Feature note](/product/features/respond-to-review.md): a **playbook recipe** — composition beside `dev-playbook` and `orchestrator`, not an engine feature — that drives the "review feedback → fix → re-review" middle of a PR: reads feedback via `gh api`, addresses each thread (fix / doc / explicit deferral), pushes to the PR **head branch**, replies once per thread, re-requests review. Closes dogfooding Phase 3's "Respond to review comments" gap row[^dogfooding].

## Approach
**One kernel, two entry points.** One recipe file — `agent-image/skills/respond-to-review/SKILL.md` (plus a `.opencode/skills/respond-to-review/SKILL.md` mirror, like the dev-playbook/okf duplication) — takes one input, **a PR number**; everything else (checkout, API contract, address/defer policy, reply discipline) lives inside it. The two entry points differ only in *who calls it and how the PR number arrives*, and both run the identical step list — which settles the Feature note's trigger/surface question and the research brief's structural fork in one move (no duplication):

1. **Standalone** — the human's one-shot: `al run --connector github --mount agent-land:/data/agent-land "respond to the review on PR #N"`.
2. **Pipeline stage** — the orchestrator spawns a `respond-review` child (new stage kind) on the shared Mount, prompted with the skill instruction + the PR number from the `implement` stage's artifact (+ any gate feedback). The child is `platform: false`; only the orchestrator holds the loopback credential.

**Why a new `respond-review` stage kind, not an `implement` re-run.** `implement` produces a fresh PR from an approved design; `respond-review` operates on an *existing* PR carrying human review — different role, different artifact (new commits + thread replies, no new PR), different termination (merge-gate `feedback:` edge, not the design gate). Reusing `implement` would overload one stage with two jobs and two budget/retry profiles. A dedicated kind keeps the planner governed (the policy stage list is the planner's vocabulary) and makes the merge-gate feedback edge explicit[^dynamic-orchestration][^policy].

**Ticket loop.** The loop's priority-1 step is already "Implementation PR has unresolved review comments → child: address feedback, push"[^ticket-loop]; `respond-to-review` **is** that step's kernel, consumed by reference (the loop's step prompt runs the skill against `<external-ref>`). The loop is still in conception, so its wiring is a follow-up — nothing duplicated into it.

## 1. GitHub API contract (correctness-critical)

**Read — three surfaces** (all I/O via `gh api`, never `gh auth login` — ADR 014 API-only, ADR 005 `gh` pre-baked; owner/repo `marcoklein/agent-land` v1):

- Inline diff comments: `GET /repos/{o}/{r}/pulls/{n}/comments` — `id`, `in_reply_to_id`, `path`, `line`, `body`, `user`, `commit_id`; a thread = its root (`in_reply_to_id == null`) + all replies.
- General/PR comments: `GET /repos/{o}/{r}/issues/{n}/comments` — flat; one reply per top-level comment.
- Review verdicts: `GET /repos/{o}/{r}/pulls/{n}/reviews` — `APPROVED` ignored; actionable `CHANGES_REQUESTED`/`COMMENTED` bodies fold into the address list; one PR-level summary reply keyed to the verdict `id`.

**Write — three endpoints** (never a *verdict* post — `POST .../reviews` with `event: APPROVED`/`CHANGES_REQUESTED` — only plain `COMMENT` replies; approve/request-changes are human actions):

- Inline thread reply: `POST .../pulls/{n}/comments/{root_id}/replies` `{ "body": "…" }`.
- General reply: `POST .../issues/{n}/comments` `{ "body": "…" }` (top-level replies + the PR-level summary).
- Re-request review: `POST .../pulls/{n}/requested_reviewers` `{ "reviewers": [...], "team_reviewers": [...] }`.

**Thread grouping + idempotency.** Group inline comments by root; a thread is addressed as one unit. **Last-speaker rule** — a thread is *pending* iff its latest comment is by a **human**; the comment trail is the idempotency ledger (matches "state = issue/PR comments, not the session tree"). Filter threads rooted by bots (`github-actions[bot]`, `dependabot[bot]`, …) or the agent's own identity. Resolution state (`resolved`/`outdated`) is GraphQL-only; v1 keys on last-speaker + filters (REST-only, covers "reply once, no double-post"); GraphQL resolution is an optional refinement.

**Re-request semantics.** Re-request = re-sending already-requested reviewers/teams via `requested_reviewers` (re-notifies; never adds reviewers). `gh pr ready` only clears draft, does **not** re-request. Read current requests via `GET .../requested_reviewers`, re-send unchanged. **Draft PRs:** reply + push but no `gh pr ready`/re-request (undrafting is an author-intent signal); report and stop. `implement` opens non-draft PRs, so non-draft is the normal path.

## 2. Recipe CLI / prompt surface

- **Kernel steps:** sync/identity → checkout head branch → read three surfaces → classify → change → `pnpm typecheck` + `pnpm test` → commit → push → reply per thread → re-request (non-draft) → markers → report. Mirrors dev-playbook but ends at "reply + re-request", **never** merge/approve[^dev-playbook].
- **Checkout/branch.** Resolve head ref via `gh pr view <n> --json headRefName,headRepository,headRepositoryOwner`; v1 requires `headRepositoryOwner.login == marcoklein` (same-repo PRs; fork → escalate). On the shared Mount: `git fetch origin` → `git checkout -B <headRefName> origin/<headRefName>` (never `main`); re-verify `GIT_USER_NAME`/`GIT_USER_EMAIL`; push via `https://x-access-token:${GITHUB_TOKEN}@github.com/marcoklein/agent-land.git HEAD`. Pre-push: `git fetch origin` + `git pull --rebase origin <headRefName>`; if the branch moved, abort and escalate — **never force-push**.

## 3. Orchestrator policy wiring (new stage kind)

```yaml
  respond-review:
    role: "review-response child — address feedback, push, reply, re-request"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    budget: { timeoutSec: 1800, maxTokens: 200000, maxCost: 2.00 }
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: merge
```

- `plan.schema.json` + `plan.mjs` — add `respond-review` to the stage `kind` enum, `STAGE_KINDS`, and `MOUNT_KINDS` (it must bind ≥1 Mount)[^plan-schema][^plan-mjs].

**Sequentiality.** `SEQUENTIAL_KINDS` is currently `{refine, design}` — the note-authoring gate stages. `implement` (also `leadsToGate: merge`) is deliberately absent, so the accurate membership rule is "note-authoring stage that may never fan out", **not** "gate-producing". `respond-review` mirrors `implement`: it is not added to `SEQUENTIAL_KINDS`; it stays sequential in practice via the shared `agent-land` Mount (DELETE-before-next), whose single-writer check forbids fan-out on that Mount. **Residual race — accepted arbiter:** that check does not catch two `respond-review` children each on a *unique* Mount (fresh clones) racing on the same PR head branch. The accepted arbiter is the pre-push `git pull --rebase` divergence abort plus GitHub's non-fast-forward push rejection; replies are posted only after a successful push, so the loser never double-posts and escalates to human.

The merge-gate feedback edge is declared as `["implement", "respond-review"]` with `leadsToGate: merge`; on `feedback:` the orchestrator re-runs the stage with feedback appended (standard gate discipline). The stage's `budget`/`retry` is planner-validatable; the orchestrator enforces the aggregate `runBudget` (soft, post-settle — ADR 011's limitation)[^adr-011][^dynamic-orchestration][^policy].

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Mount single-writer violation.** | Engine invariant: one live session per Mount (409). Pipeline: bind the shared Mount only after `implement` settles and is `DELETE`d; parallel children get unique `agent-land-<stage>-<runId>` Mounts. Two simultaneous standalone runs on the same PR: the second bind 409s and waits/escalates[^mount-design]. |
| **Concurrent/wrong-branch push** (human pushes mid-run, or responder edits `main`). | Resolve the head ref explicitly, checkout `origin/<headRefName>`; pre-commit guard (`rev-parse --abbrev-ref HEAD` == head branch). Pre-push `pull --rebase` detects divergence → abort + escalate; never force-push. |
| **Infinite loop / double-post.** | One pass per invocation, never loops internally; each round is human-triggered. A round counter ("respond-to-review round N") caps auto re-requests at 3 then escalates; per-stage `retry` + aggregate `runBudget` bound the rest[^adr-011]. Idempotency by last-speaker + start/done markers; crash-and-resume re-derives "pending" from the comment trail. |
| **Never merge/approve.** | Hard rule (inherited from dev-playbook + trust ladder); only the `github` connector, no deploy path, only `COMMENT` posts — approve/merge is structurally impossible; the human merge button is the gate[^dogfooding][^dev-playbook]. |
| **Deferral = silent scope drop.** | Deferral minimum: name the comment, state reason, open a follow-up issue for genuine gaps ("gaps are tickets"). `must-fix` is never deferred. |
| **Soft budget overrun.** | Accepted (as in dynamic orchestration): orchestrator post-settle accounting + wall-clock bound; hard kill-switch remains ADR 011 future work[^adr-011][^dynamic-orchestration]. |

## ADR pointers
No new ADR — a recipe, not an architecture decision. Existing records reused:

- **017** — pipeline + recipes live outside the engine on OKF memory; this is a recipe in that layer[^adr-017].
- **011** — stage `budget`/`retry` + aggregate `runBudget` enforced orchestrator-side (soft)[^adr-011].
- **019** — ticket-loop state location; consumed by reference, wiring deferred.
- **014** (API-only), **005** (`gh` pre-baked), **016** (no in-core orchestration), **015** (per-stage `provider`/`model`) — supporting, unchanged.

## Minimal change set
Recipe-only; zero `packages/*` changes.

- `agent-image/skills/respond-to-review/SKILL.md` — new kernel (core change).
- `.opencode/skills/respond-to-review/SKILL.md` — new mirror (identical).
- `agent-image/skills/orchestrator/policy.yaml` — add the `respond-review` stage.
- `agent-image/skills/orchestrator/plan.schema.json` + `plan.mjs` — add to the `kind` enum, `STAGE_KINDS`, `MOUNT_KINDS`.
- `docs/knowledge/playbook/dogfooding.md` + `docs/knowledge/product/designs/index.md` — flip the Phase 3 row to done; index the note.

The two `dev-playbook` copies are unchanged — review response is a sibling skill; the dev loop keeps ending at "report, don't merge."

## Open questions answered
The Feature note's six open questions are answered above: trigger/surface + ticket loop (§Approach), address-vs-defer + loop safety (§Risks), review-surface coverage + re-request semantics (§1).

[^dogfooding]: [Dogfooding — the agent-land playbook](/playbook/dogfooding.md)
[^mount-design]: [Mount design](/product/designs/mount-design.md)
[^dynamic-orchestration]: [Dynamic Orchestration design](/product/designs/dynamic-orchestration-design.md)
[^policy]: `agent-image/skills/orchestrator/policy.yaml`
[^plan-schema]: `agent-image/skills/orchestrator/plan.schema.json`
[^plan-mjs]: `agent-image/skills/orchestrator/plan.mjs`
[^dev-playbook]: [Dev-loop recipe](agent-image/skills/dev-playbook/SKILL.md)
[^ticket-loop]: [Ticket loop](/playbook/ticket-loop.md)
[^adr-017]: [ADR 017 — product layer on OKF memory](/adrs/017-product-layer-okf-memory.md)
[^adr-011]: [ADR 011 — per-run kill switch](/adrs/011-kill-switch.md)
