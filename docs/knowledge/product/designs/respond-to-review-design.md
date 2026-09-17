---
type: Design
title: Respond to Review
description: Design for the respond-to-review playbook recipe — reads PR review feedback via gh api, addresses each thread (fix / doc / explicit deferral), pushes to the PR head branch, replies once per thread, and re-requests review. One kernel, two entry points (standalone prompt + orchestrator respond-review stage). Closes dogfooding Phase 3; recipe-only, zero engine change.
status: draft
tags: [dogfooding, review, github, composition, recipe, orchestration]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-17T14:55:29Z }
sources:
  - id: feature
    resource: /product/features/respond-to-review.md
    title: Respond to Review Feature note
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
  - id: pipeline
    resource: /product/pipeline.md
    title: The product pipeline
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: boundaries
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: mount-design
    resource: /product/designs/mount-design.md
    title: Mount design — single-writer invariant
  - id: dynamic-orchestration
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration design
  - id: orchestrator-skill
    resource: agent-image/skills/orchestrator/SKILL.md
    title: Orchestrator recipe (planner)
  - id: policy
    resource: agent-image/skills/orchestrator/policy.yaml
    title: Orchestrator policy (stage kinds, budgets)
  - id: plan-schema
    resource: agent-image/skills/orchestrator/plan.schema.json
    title: plan.json contract
  - id: plan-mjs
    resource: agent-image/skills/orchestrator/plan.mjs
    title: plan.json validator + budget calculator
  - id: dev-playbook
    resource: agent-image/skills/dev-playbook/SKILL.md
    title: The development loop recipe
  - id: github-skill
    resource: agent-image/skills/github/SKILL.md
    title: GitHub (gh / gh api) conventions
  - id: ticket-loop
    resource: /playbook/ticket-loop.md
    title: Ticket loop — the dogfooding heartbeat
  - id: adr-017
    resource: /adrs/017-product-layer-okf-memory.md
    title: Build a Product Layer on OKF Memory with an Agentic Pipeline
  - id: adr-011
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: adr-019
    resource: /adrs/019-ticket-layer-git-synced-repo.md
    title: Keep the Ticket Layer in a Separate Git-Synced Repo
  - id: adr-014
    resource: /adrs/014-json-api-canonical-machine-interface.md
    title: JSON API is the canonical machine interface
  - id: adr-016
    resource: /adrs/016-strip-web-ui-and-vendor-knowledge.md
    title: Strip Web UI and Vendor Knowledge from Server
  - id: adr-005
    resource: /adrs/005-agent-tool-strategy.md
    title: Pre-Baked Tools + Runtime Installation
  - id: adr-015
    resource: /adrs/015-providers-as-config-records-projected-into-pi.md
    title: Providers are config records projected into pi
  - id: git-identity
    resource: /product/designs/git-identity-design.md
    title: Git identity injection
---

# Respond to Review

The design for [the Respond to Review Feature note](/product/features/respond-to-review.md): a **playbook recipe** that drives the "review feedback → fix → re-review" middle of a PR. It reads a PR's review feedback via `gh api`, addresses each thread (a code change, a doc update, or an explicit deferral with reasoning), pushes to the PR **head branch**, replies once per review thread, and re-requests review. It is composition — a recipe beside `dev-playbook` and `orchestrator`, not an engine feature — and it closes the dogfooding Phase 3 gap row ("Respond to review comments" — *"✅ Works — `gh api` to read + reply"* but *"a trigger loop; today the human re-prompts"*)[^dogfooding][^feature].

## Approach

**One kernel, two entry points.** The whole behavior lives in a single recipe file — `agent-image/skills/respond-to-review/SKILL.md` (with a `.opencode/skills/respond-to-review/SKILL.md` mirror for laptop-side use, matching the dev-playbook/okf duplication) — that takes one input: **a PR number**. Everything else (the checkout, the API contract, the address/defer policy, the reply discipline) is inside that kernel. The two entry points differ only in *who invokes the kernel and how the PR number arrives*:

1. **Standalone** — the human's one-shot: `al run --connector github --mount agent-land:/data/agent-land "respond to the review on PR #N"`. The skill is the instruction; the human names the PR.
2. **Pipeline stage** — the orchestrator spawns a `respond-review` child (new policy stage kind) bound to the shared repo Mount, prompted with the same skill instruction plus the PR number taken from the `implement` stage's artifact (and any gate-feedback context appended). The child is `platform: false`; only the orchestrator has the loopback credential.

This resolves the Feature note's trigger/surface question and the research brief's second structural fork in one move: **no duplication** — the standalone form and the stage form run the *identical* step list; the only difference is the caller and the context injected into the prompt.

**Why a new `respond-review` stage kind, not an `implement` re-run.** The current `feedback:` gate path re-runs the stage that *produced* the artifact (e.g. re-run `design` after design-gate feedback). Review response is different in kind: `implement` produces a fresh PR from an approved design; `respond-review` operates on an *existing* PR carrying human review, with a different role, a different artifact (new commits + thread replies, no new PR), and a different termination point (the merge gate's `feedback:` edge, not the design gate). Reusing `implement` would overload one stage with two divergent jobs and two different budget/retry profiles. A dedicated kind keeps the planner governed — the policy's stage list is exactly the vocabulary the planner may pick from — and makes the merge-gate feedback edge explicit in the plan graph[^dynamic-orchestration][^policy].

**Relationship to the ticket loop.** The ticket loop's priority-1 step is already *"Implementation PR has unresolved review comments → child: address feedback, push"*[^ticket-loop]. `respond-to-review` **is** that step's kernel: the loop's step child is an agent-land session prompted with the same skill instruction (the ticket loop's step prompt says "run the respond-to-review skill against `<external-ref>`"), exactly like the pipeline-stage form. The kernel is shared by reference; the ticket loop itself remains in conception, so its wiring is a follow-up, not part of this change. No new code is duplicated into the loop.

## Interfaces

### 1. GitHub API contract (the correctness-critical surface)

All reads/writes go through `gh api` (the GitHub Connector's `GITHUB_TOKEN`), never `gh auth login`, consistent with ADR 014 (API-only) and ADR 005 (`gh` is pre-baked in the agent image)[^adr-014][^adr-005][^github-skill]. Owner/repo are `marcoklein/agent-land` for v1.

**Read — three surfaces, three object shapes:**

| Surface | Endpoint | Object | Threading |
|---|---|---|---|
| Inline diff comments | `GET /repos/{o}/{r}/pulls/{n}/comments` | review comments: `id`, `in_reply_to_id` (null = root), `path`, `line`/`original_line`/`start_line`, `body`, `user`, `commit_id`, `pull_request_review_id` | threads form via `in_reply_to_id`; a thread = its root + all replies |
| General PR / issue comments | `GET /repos/{o}/{r}/issues/{n}/comments` | issue comments: `id`, `body`, `user`, `created_at`, (`pull_request_review_id` when a review body) | flat; one reply per top-level comment |
| Whole-PR review verdicts | `GET /repos/{o}/{r}/pulls/{n}/reviews` | reviews: `id`, `user`, `state` (`APPROVED` / `CHANGES_REQUESTED` / `COMMENTED`), `body`, `commit_id`, `submitted_at` | one reply per verdict with actionable text |

**Write — three endpoints:**

- **Thread reply** (inline): `POST /repos/{o}/{r}/pulls/{n}/comments/{root_id}/replies` with `{ "body": "…" }` — replies under the thread root, so GitHub threads the answer and notifies the human.
- **General reply** (issue/PR-level): `POST /repos/{o}/{r}/issues/{n}/comments` with `{ "body": "…" }`. Used both for replying to a top-level comment and for the PR-level "addressed summary" reply keyed to a `CHANGES_REQUESTED`/`COMMENTED` review.
- **Re-request review**: `POST /repos/{o}/{r}/pulls/{n}/requested_reviewers` with `{ "reviewers": ["login"], "team_reviewers": ["org/team"] }`.

The recipe never posts a review *verdict* (`POST /repos/{o}/{r}/pulls/{n}/reviews` with `event: APPROVED`/`CHANGES_REQUESTED`) — it only ever writes plain `COMMENT` replies. Approve/request-changes are human reviewer actions, not the author's.

**Thread grouping and dedup (idempotency):**

1. Group inline comments by root: `in_reply_to_id == null` is a root; each non-null comment attaches to its root. A thread is addressed as one unit (the root carries `path` + `line`).
2. **Last-speaker rule** — a thread is *pending* iff its most recent comment is authored by a **human** (not the agent's own identity, not a bot). If the agent already replied (last speaker is the agent), the thread is skipped. The GitHub comment trail is therefore the idempotency ledger — no separate state store, matching the session-lifecycle learning ("state = issue/PR comments, not the session tree").
3. Filter out threads whose root is authored by a bot (`github-actions[bot]`, `dependabot[bot]`, …) or by the agent's own commit identity.
4. Resolution state (`resolved`/`outdated`) is **not** exposed by the REST endpoints above — it is GraphQL-only (`PullRequest.reviewThreads.isResolved`). v1 therefore keys on last-speaker + bot/self filters, which is REST-only and covers the required behavior ("reply once per thread, no double-post"). GraphQL resolution is noted as an optional refinement, not v1.

**Review-surface coverage (what is read, what is replied to):**

- **Inline threads** → read and replied to, one reply per pending root thread (replies endpoint).
- **General/issue comments** → read; any top-level human comment that poses an actionable request and lacks an agent reply gets one reply (issues-comments endpoint). There is no nesting, so "one reply per top-level comment" is the grouping.
- **Review verdicts** → `APPROVED` is read and ignored (nothing to do). `CHANGES_REQUESTED` and actionable `COMMENTED` bodies are read; their actionable items are folded into the same address list as the threads. One PR-level summary reply (issues-comments endpoint) states what was fixed/deferred per item, keyed to the verdict's `id`.

**Re-request semantics (concrete):**

- Re-requesting a reviewer is **only** `POST /repos/{o}/{r}/pulls/{n}/requested_reviewers` re-sending reviewers — a repeat of the same list re-notifies; a brand-new reviewer is not added. `gh pr ready` only clears draft status and does **not** re-request anyone.
- Procedure: read current requests via `GET /repos/{o}/{r}/pulls/{n}/requested_reviewers`; re-send `reviewers` (logins) and `team_reviewers` (`org/team` slugs) unchanged. Bots and teams are passed as-is; do not add reviewers the human didn't already request (no new-reviewer spam).
- **Draft PRs:** if `draft == true`, the recipe replies and pushes but does **not** `gh pr ready` and does **not** re-request — undrafting is an author-intent signal the recipe cannot safely infer. It reports "PR is draft; ready + re-request left to the human" and stops. (Non-draft is the normal path; the `implement` stage opens non-draft PRs.)

### 2. Recipe CLI / prompt surface

- **Standalone form:** `al run --connector github --mount agent-land:/data/agent-land "respond to the review on PR #N"` (laptop-side: opencode with the `.opencode/skills/respond-to-review/SKILL.md` copy). The prompt is free-form; the skill body is the executable spec.
- **Skill step list (the kernel):** sync/identity → bind checkout and resolve the head branch → read the three surfaces → classify each pending thread → make changes → `pnpm typecheck` + `pnpm test` → commit → push to head branch → reply per thread → re-request (non-draft) → post start/done markers → report. Steps mirror the dev-playbook loop but end at "reply + re-request", **never** merge/approve[^dev-playbook].
- **Checkout / branch mechanics.** Resolve the head ref with `gh pr view <n> --json headRefName,headRepository,headRepositoryOwner`. v1 requires `headRepositoryOwner.login == marcoklein` (same-repo PRs); a fork PR escalates to human. On the shared Mount: `git fetch origin`, then `git checkout -B <headRefName> origin/<headRefName>` (never `main`). Re-verify identity: `git config user.name "$GIT_USER_NAME"` / `user.email "$GIT_USER_EMAIL"`[^git-identity]. Push via `https://x-access-token:${GITHUB_TOKEN}@github.com/marcoklein/agent-land.git HEAD`. Before pushing, `git fetch origin` again and `git pull --rebase origin <headRefName>`; if the head branch moved under it (human pushed), abort and escalate — **never force-push**.

### 3. Orchestrator policy wiring (a new stage kind)

`respond-review` joins the planner's vocabulary. The policy is the only place the planner may draw a stage kind from, so the wiring is three files plus the policy entry[^policy][^plan-schema][^plan-mjs]:

- **`agent-image/skills/orchestrator/policy.yaml`** — add a stage:

```yaml
  respond-review:
    role: "review-response child — address review feedback, push, reply, re-request"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    budget: { timeoutSec: 1500, maxTokens: 150000, maxCost: 1.50 }
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: merge
```

- **`agent-image/skills/orchestrator/plan.schema.json`** — extend the stage `kind` enum with `respond-review`.
- **`agent-image/skills/orchestrator/plan.mjs`** — add `respond-review` to `STAGE_KINDS` and to `MOUNT_KINDS` (it must bind at least one Mount). It stays a **sequential** stage in practice because it shares the `agent-land` Mount with `implement` (DELETE-before-next); it is not added to `SEQUENTIAL_KINDS` (that set is reserved for gate-producing stages), but the shared-Mount single-writer check already forbids it from ever fanning out on that Mount.

In a plan, the merge-gate feedback edge is declared explicitly: `["implement", "respond-review"]` with `respond-review.leadsToGate: "merge"`; when the human sends `feedback:` at the merge gate, the orchestrator re-runs the `respond-review` stage with the feedback appended (the same gate-discipline pattern as every other stage). The stage carries a `budget`/`retry` entry so the planner can validate it and the orchestrator enforces the aggregate `runBudget` (soft, post-settle — ADR 011's stated limitation)[^adr-011][^dynamic-orchestration].

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Mount single-writer violation.** A `respond-review` child binding the shared Mount while `implement` is still live, or two simultaneous responders on the same checkout. | Hard engine invariant: at most one live session per Mount (409 refusal). As a pipeline stage, `respond-review` binds the shared `agent-land` Mount **only after `implement` has settled and been `DELETE`d**; the orchestrator binds no Mount; parallel children each get a uniquely named `agent-land-<stage>-<runId>` Mount, deleted after settle — never a shared live `.git`. The standalone form is one session on the Mount. Two simultaneous standalone runs targeting the same PR head branch are arbitrated by the same 409 (second run's bind fails and it waits/escalates)[^mount-design][^orchestrator-skill]. |
| **Concurrent push to the PR head branch** (human pushes while the responder works). | The head branch is single-writer by construction: `git fetch` + `pull --rebase` before push detects divergence and the recipe aborts and escalates; it never force-pushes. |
| **Infinite respond/re-review loop.** | The recipe does exactly **one pass** over currently-pending threads and stops — it never loops internally. Each new round is human-triggered (standalone: human re-prompts; pipeline: merge-gate `feedback:` re-runs the stage), so the human is the loop breaker. Belt-and-suspenders: a **round counter** in PR comments (`respond-to-review round N`) caps automatic re-requests at 3 rounds, after which the recipe escalates-to-human (parks) instead of re-requesting. Per-stage `retry.maxAttempts` (2 total) plus the aggregate `runBudget` bound the rest[^adr-011]. |
| **Double-post to the same thread.** | Idempotency by construction: the **last-speaker rule** (skip any thread whose latest comment is the agent's) plus start/done marker comments. The GitHub comment trail is the ledger, so a crash-and-resume re-derives "still pending" and skips already-replied threads. |
| **Never merges / never approves.** | Hard rule stated in the skill (and inherited from dev-playbook and the trust ladder): reply, push, and re-request are permitted; approve, merge, and deploy are not (Phase 5). The recipe has only the `github` connector, no deploy path, and posts only `COMMENT`-type replies — it can't approve or merge even by accident; the human gate is the merge button[^dogfooding][^dev-playbook]. |
| **Deferral becomes silent scope drop.** | Minimum bar for deferral: the reply names the comment, states the reason, and — for any genuine product gap — opens a follow-up issue ("gaps are tickets"). A `must-fix` is never deferred; it is fixed or escalated to human. |
| **Soft budget overrun.** | Same accepted limitation as dynamic orchestration: orchestrator-side post-settle accounting (`collect_usage`), with the stage's wall-clock bound caught by the bounded watch. Hard server-side kill switches remain ADR 011 future work[^adr-011][^dynamic-orchestration]. |
| **Mirror drift between the two skill copies.** | The two dev-playbook copies have **already drifted** (observed during this design); `respond-to-review` must be born with both copies identical, and any later edit updates both. Flagged, not fixed here. |
| **Wrong branch pushed** (responder edits `main` instead of the head branch). | The skill resolves the head ref explicitly and checks out `origin/<headRefName>`; a pre-commit guard (`git rev-parse --abbrev-ref HEAD` must equal the head branch) rejects the run otherwise. |

## ADR pointers

No new ADR is warranted — this is a recipe, not an architecture decision (the mount-design ADR-pointer pattern applies). Each adjacent decision reuses an existing record:

- **ADR 017** — the governing decision: the pipeline and its recipes live outside the engine on OKF memory; `respond-to-review` is a recipe in exactly that layer[^adr-017].
- **ADR 011** — the new stage's `budget`/`retry` and the aggregate `runBudget`, enforced orchestrator-side (soft), with hard enforcement remaining future work[^adr-011].
- **ADR 019** — where the ticket loop's state lives; relevant only insofar as the ticket loop consumes this kernel by reference (wiring deferred)[^adr-019].
- **ADR 014** (API-only), **ADR 016** (no in-core orchestration/vendor knowledge), **ADR 005** (`gh` pre-baked), **ADR 015** (per-stage `provider`/`model` at child-create) — supporting; none is changed[^adr-014][^adr-016][^adr-005][^adr-015].

## Minimal change set

Recipe-only; **zero `packages/*` changes**, no engine code, no CLI changes, no new endpoints.

- `agent-image/skills/respond-to-review/SKILL.md` — **new** kernel recipe (the core change).
- `.opencode/skills/respond-to-review/SKILL.md` — **new** mirror for laptop-side use (identical).
- `agent-image/skills/orchestrator/policy.yaml` — add the `respond-review` stage kind (role, connectors, mounts, budget, retry, `leadsToGate: merge`).
- `agent-image/skills/orchestrator/plan.schema.json` — add `respond-review` to the stage `kind` enum.
- `agent-image/skills/orchestrator/plan.mjs` — add `respond-review` to `STAGE_KINDS` and `MOUNT_KINDS`.
- `docs/knowledge/playbook/dogfooding.md` — flip the Phase 3 row to done and mark the "Respond to review comments" gap row done.
- `docs/knowledge/product/designs/index.md` (+ optionally `features/index.md`) — index the new note.

Post-dogfood (separate run, not this PR): a `docs/knowledge/learnings/` note and a `dogfooding.md` success-signal update.

The two `dev-playbook` copies are **not** changed — review response is a sibling skill, not a step appended to the dev loop; the dev loop keeps ending at "report, don't merge."

## Answers to the Feature note's open questions

1. **Trigger/surface.** Standalone = `al run --connector github --mount agent-land:/data/agent-land "respond to the review on PR #N"`; pipeline = an orchestrator `respond-review` child. One recipe, two entry points — the kernel is the same SKILL.md, only the caller and the PR number differ (§Approach). Not an issue+label (that's the pipeline's intake, a different trigger).
2. **Address-vs-defer.** "Addressed" = one of: code change pushed, doc update pushed, or explicit deferral with reasoning. Per-comment classification: `must-fix` (correctness/CI/gate-blocking — never deferred), `should-fix` (fixed this pass), `nit` (fixed opportunistically or deferred with a one-line reason). Deferral minimum bar: name the comment, state the reason, and open a follow-up issue for genuine gaps (§Risks).
3. **Review-surface coverage.** All three are read; inline threads and general comments are replied to (one reply per thread/comment), verdict bodies are folded into the address list and answered with one PR-level summary reply; `APPROVED` is ignored (§Interfaces 1).
4. **Re-request semantics.** Re-request = re-sending the already-requested reviewers/teams via `requested_reviewers` (re-notifies); `gh pr ready` does not re-request and is only relevant to draft status. Draft PRs: reply + push but no `gh pr ready`/re-request — left to the human (§Interfaces 1).
5. **Loop safety.** One pass per invocation; rounds are human-triggered; a 3-round counter caps automatic re-requests before escalate-to-human; per-stage retry budget + aggregate `runBudget` bound the rest. Idempotency via the last-speaker rule + marker comments (§Risks).
6. **Ticket-loop relationship.** **Yes** — `respond-to-review` is the single reusable kernel the ticket loop's priority-1 step calls; the loop consumes it by reference, and its wiring lands with the loop itself (still in conception), not in this change (§Approach).

[^feature]: [Respond to Review Feature note](/product/features/respond-to-review.md) — scope, stories, acceptance criteria, open questions
[^dogfooding]: [Dogfooding — the agent-land playbook](/playbook/dogfooding.md) — Phase 3 spec, gaps table, trust ladder
[^pipeline]: [The product pipeline](/product/pipeline.md) — stages, gates, the `feedback:` re-run path
[^engine]: [Agent Land engine](/platform/engine.md) — six primitives, invariants (esp. #1 single-writer)
[^boundaries]: [Agent Land domain boundary](/product/goals/boundaries.md) — composition, not engine
[^mount-design]: [Mount design](/product/designs/mount-design.md) — hard single-writer invariant, DELETE-before-next
[^dynamic-orchestration]: [Dynamic Orchestration design](/product/designs/dynamic-orchestration-design.md) — policy/plan artifacts, budgets, retries
[^orchestrator-skill]: [Orchestrator recipe](agent-image/skills/orchestrator/SKILL.md) — child lifecycle, Mount invariant, gates
[^policy]: `agent-image/skills/orchestrator/policy.yaml` — the stage-kind list, budgets, invariants
[^plan-schema]: `agent-image/skills/orchestrator/plan.schema.json` — plan artifact contract
[^plan-mjs]: `agent-image/skills/orchestrator/plan.mjs` — validator + budget calculator
[^dev-playbook]: [Dev-loop recipe](agent-image/skills/dev-playbook/SKILL.md) — branch → checks → PR → green; never merge
[^github-skill]: [GitHub conventions](agent-image/skills/github/SKILL.md) — gh / gh api
[^ticket-loop]: [Ticket loop](/playbook/ticket-loop.md) — priority-1 step is already "address feedback, push"
[^adr-017]: [ADR 017 — product layer on OKF memory](/adrs/017-product-layer-okf-memory.md)
[^adr-011]: [ADR 011 — per-run kill switch](/adrs/011-kill-switch.md)
[^adr-019]: [ADR 019 — ticket layer in a separate git-synced repo](/adrs/019-ticket-layer-git-synced-repo.md)
[^adr-014]: [ADR 014 — JSON API canonical](/adrs/014-json-api-canonical-machine-interface.md)
[^adr-016]: [ADR 016 — strip web UI and vendor knowledge](/adrs/016-strip-web-ui-and-vendor-knowledge.md)
[^adr-005]: [ADR 005 — pre-baked tools](/adrs/005-agent-tool-strategy.md)
[^adr-015]: [ADR 015 — providers as config records](/adrs/015-providers-as-config-records-projected-into-pi.md)
[^git-identity]: [Git identity injection](/product/designs/git-identity-design.md) — `GIT_USER_NAME`/`GIT_USER_EMAIL`
