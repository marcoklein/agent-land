---
type: Design
title: Review Response
description: The respond-to-review recipe — a skill that reads PR review feedback via gh api, groups it into threads, addresses each thread or defers with reasoning (escalate-don't-decide), pushes fixes, replies per thread, and re-requests review via requested_reviewers; exposed as a new respond-review orchestrator stage kind. Composition only; no engine/CLI change; merge stays human-gated.
status: draft
tags: [playbook, recipe, dogfooding, review, github, orchestration, composition, skill]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-17T22:05:00Z }
sources:
  - id: feature
    resource: /product/features/review-response.md
    title: Review Response Feature note
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — Phase 3, the gap table, the trust ladder
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — six primitives
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: mount-design
    resource: /product/designs/mount-design.md
    title: Mount design — single-writer invariant
  - id: platform-connector-design
    resource: /product/designs/platform-connector-design.md
    title: Platform Connector design — loopback, ephemeral per-session auth
  - id: dynamic-orchestration-design
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic orchestration design — stage kinds, budgets, retries
  - id: git-identity-design
    resource: /product/designs/git-identity-design.md
    title: Git identity injection — connector-wins identity
  - id: dev-playbook
    resource: agent-image/skills/dev-playbook/SKILL.md
    title: Dev playbook — the branch → green-PR loop
  - id: orchestrator
    resource: agent-image/skills/orchestrator/SKILL.md
    title: Orchestrator recipe — planner discipline
  - id: policy
    resource: agent-image/skills/orchestrator/policy.yaml
    title: Orchestrator policy — stage kinds, budgets, retries
  - id: ticket-loop
    resource: /playbook/ticket-loop.md
    title: Ticket loop — decision rule #1, advance-to-the-gate discipline
  - id: adr-011
    resource: /adrs/011-kill-switch.md
    title: ADR 011 — per-run budgets (soft enforcement)
  - id: adr-017
    resource: /adrs/017-product-layer-okf-memory.md
    title: ADR 017 — product layer on OKF memory, pipeline outside the engine
  - id: trigger-learn
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger — marker-based dedupe
  - id: orch-learn
    resource: /learnings/first-orchestrated-run.md
    title: First orchestrated run — exact connector names, verify against live state
---

# Review Response

The concrete recipe for dogfooding Phase 3: turn a human's PR review feedback into pushed fixes, per-thread replies, and a re-requested review — from a prompt like "respond to the review on PR #N" (standalone) or as a `respond-review` stage child spawned by the orchestrator. It is a **playbook/recipe feature, not an engine feature**: it composes the six engine primitives exactly as they are, with **zero changes to `packages/server`, `packages/contracts`, or the CLI**[^engine][^boundary].

## Approach

The recipe is delivered in three parts: **(1) the skill**, **(2) the orchestrator integration**, and **(3) the risk posture**.

### Part 1 — the `respond-to-review` skill

The canonical home is `agent-image/skills/respond-to-review/SKILL.md`, mirrored at `.opencode/skills/respond-to-review/SKILL.md` for the laptop-side flow. It **composes** the [dev-playbook](/playbook/dogfooding.md) loop (branch → edit → `pnpm typecheck`/`pnpm test` → commit → push → `gh pr checks --watch`) and the [github](agent-image/skills/github/SKILL.md) skill (`gh api`), and adds only the review-specific discipline: read feedback, group threads, decide address vs. defer vs. escalate, reply per thread, re-request. It does **not** re-implement the dev loop — the "make the fix" step delegates to it.

The skill's step sequence (deterministic steps run as commands; AI only at the decision points):

1. **Resolve the PR.** `gh api repos/{owner}/{repo}/pulls/{n}` (always explicit `--repo`; there is no inferred repo). Capture `head.sha`, `requested_reviewers[].login`, `requested_teams[].slug`, `draft`, `state`.
2. **Probe token scope.** `gh api repos/{owner}/{repo} --jq .permissions` — confirm `pull_requests` and `push` before doing any work; if absent, escalate (§Risks).
3. **Read all feedback** (three calls):
   - inline review comments — `GET /repos/{owner}/{repo}/pulls/{n}/comments`;
   - PR reviews — `GET /repos/{owner}/{repo}/pulls/{n}/reviews` (note any `state == CHANGES_REQUESTED`);
   - general PR/issue comments — `GET /repos/{owner}/{repo}/issues/{n}/comments`.
4. **Group into threads** by `in_reply_to_id` (a top-level comment has it null/absent). One root + its descendants = one thread.
5. **Decide per thread — address / defer / escalate** (rule below). Never silently drop.
6. **Apply the dev-playbook loop once** for the union of address decisions: edit → `pnpm typecheck` + `pnpm test` → commit → push (via `x-access-token`) → `gh pr checks --watch` until green.
7. **Reply per thread.** For each inline thread, `POST /repos/{owner}/{repo}/pulls/{n}/comments/{comment_id}/replies` with a body carrying the idempotency marker and the outcome (`Addressed in <sha>` / `Deferred: <reason>` / `Escalated: <reason>`). For a `CHANGES_REQUESTED` review whose body has no inline threads, post **one** general comment (`POST .../issues/{n}/comments`) summarizing the response.
8. **Re-request review** via `POST /repos/{owner}/{repo}/pulls/{n}/requested_reviewers` with the original human reviewer(s) (§Interfaces).
9. **Settle with a report** — PR URL, per-thread disposition, re-requested reviewers, CI status, any escalations. **Never merge, never approve, never bypass a gate.**

**Decision rule (the AI decision point).**

- **Address** — correctness bugs, security issues, CI/typecheck/test failures, and any item in a blocking `CHANGES_REQUESTED` review that lies within the agent's authority (edits confined to the PR's scope).
- **Defer (with reasoning)** — no code change; the reason is recorded in the thread reply: the comment is a question the agent answers, a style/nit preference it declines, already addressed elsewhere (cite the sha), or out of scope for the review.
- **Escalate (park, don't decide)** — a comment that contradicts an ADR, requests a design/architecture/interface decision, changes scope, or would require a new ADR. The agent does **not** "fix" it; it posts a thread reply stating a human decision is needed and settles with an escalation report. Escalation is always a park, never autonomous abandonment[^ticket-loop].

### Part 2 — orchestrator integration

Add a **`respond-review` stage kind** to [`policy.yaml`](agent-image/skills/orchestrator/policy.yaml). The stage-kind list is closed ("you never invent a kind")[^dynamic-orchestration-design], so this is a **policy edit**, not an engine change — the policy file is a prompt-level recipe artifact under ADR 017[^adr-017].

```yaml
  respond-review:
    role: "review-response child — address PR review feedback to a green, re-requested PR"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    budget: { timeoutSec: 1800, maxTokens: 200000, maxCost: 2.00 }
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: merge
```

- **Sequential shared Mount.** The child binds the shared `agent-land` Mount **one at a time** — the Mount single-writer invariant is the hard enforcement (a second bind fails with 409, no `--force`)[^mount-design]. The orchestrator itself binds no Mount, and the child is `DELETE`d before the next child is created[^orchestrator].
- **`github` connector.** The write-capable token (push, post replies, `requested_reviewers`). Commit identity comes from the connector-injected `GIT_USER_NAME`/`GIT_USER_EMAIL` (connector wins); push via `x-access-token`; `gh` reads `GITHUB_TOKEN` via `GH_TOKEN`; never `gh auth login`[^git-identity-design].
- **Budget + retry.** Same shape as `implement` — bounded by ADR 011 soft budgets, with failure/stall retry and escalate-to-human on exhaustion[^adr-011].
- **`leadsToGate: merge`.** Re-requesting review advances the PR back to the human merge gate; the stage never crosses it.
- **Re-invocation at the merge gate.** The existing merge-gate feedback path (the orchestrator re-prompts the stage that produced the artifact with the new feedback) re-invokes `respond-review` with the PR number and the new review wave. The stage is **one-shot per wave**; re-triggering is the operator's (standalone) or the orchestrator's (stage) job.
- **Idempotency markers.** Same discipline as the pipeline trigger's marker comments[^trigger-learn]: every agent reply carries a marker prefix, and re-runs skip already-answered threads (§Interfaces).

### Part 3 — risk posture (summary)

Three structural mitigations shape everything above: **Mount contention** is ruled out by *sequential only*; **double-reply** is ruled out by *markers*; **over-eager changes** are ruled out by the *escalate-don't-decide* rule plus ADR 011 budgets; **token scope** is confirmed up front by a *capability probe*. Full table in §Risks & mitigations.

## Interfaces

### GitHub API endpoints (exact)

All via `gh api` with the repo always explicit; the REST paths are the canonical contract.

| Verb | Endpoint | Used for |
|---|---|---|
| `GET` | `/repos/{owner}/{repo}/pulls/{pull_number}` | `head.sha`, `requested_reviewers[].login`, `requested_teams[].slug`, `draft`, `state` |
| `GET` | `/repos/{owner}/{repo}` | `.permissions` — token-scope probe before work |
| `GET` | `/repos/{owner}/{repo}/pulls/{pull_number}/comments` | inline (diff-attached) review comments: `id`, `in_reply_to_id`, `user.login`, `body`, `path`, `line` |
| `GET` | `/repos/{owner}/{repo}/pulls/{pull_number}/reviews` | PR reviews: `state` ∈ `APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`/`DISMISSED`, `user.login`, `body` |
| `GET` | `/repos/{owner}/{repo}/issues/{pull_number}/comments` | general (non-diff) PR/issue comments |
| `POST` | `/repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` | reply to one inline review comment (`{"body": "…"}`) |
| `POST` | `/repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` | re-request review (`{"reviewers": ["alice"]}` and/or `{"team_reviewers": ["core"]}`) |
| `POST` | `/repos/{owner}/{repo}/issues/{pull_number}/comments` | summary reply when a `CHANGES_REQUESTED` review has no inline threads |

**Correction carried from the Feature note:** `gh pr ready` only clears draft status — it does **not** re-request a reviewer. Re-request is `POST .../pulls/{n}/requested_reviewers` only.

**Thread grouping rule.** A thread = one top-level comment (`in_reply_to_id` null/absent) plus its descendants (`in_reply_to_id` pointing back up the chain). Each top-level inline comment is one thread; a PR review object is a separate *summary* source, not a thread — its `body` is answered by the single summary reply only when it has no inline comments. Per-thread replies are **required**; one summary review does **not** substitute for per-thread replies.

**Re-request rule.** Re-request the original reviewer(s) parsed from (a) the blocking review's `user.login` and (b) the PR's `requested_reviewers`/`requested_teams`. Filter bot accounts (`GET /users/{login}` `type == "Bot"`, or the known bot pattern). If there is no explicit human reviewer (CODEOWNERS/team review), **skip re-request and say so in the report** — never fabricate a reviewer.

### The skill's prompt contract

- **Inputs:** `--repo owner/repo` (required) and a PR number (required when named). Standalone: "respond to the review on PR #N". Stage: the orchestrator passes the PR number and repo in the stage prompt. **With no PR number** (standalone only): discover the single open PR on the current branch via `gh pr list --head "$(git branch --show-current)" --state open`; if zero or more than one, stop and ask.
- **Environment:** `GITHUB_TOKEN` (exported as `GH_TOKEN`), `GIT_USER_NAME`, `GIT_USER_EMAIL` — all connector-injected. Never `gh auth login`.
- **Mount / checkout:** standalone uses the operator's existing checkout or Mount; the stage child binds `agent-land` at `/data/agent-land`, syncs (`git fetch origin`), and checks out the PR branch via `gh pr checkout {n}` (fallback: `git fetch origin pull/{n}/head`).
- **Output (settle report):** PR URL · per-thread disposition (addressed / deferred / escalated, with shas and reasons) · re-requested reviewers · CI status (`gh pr checks`) · any escalations.
- **Marker (idempotency):** every agent reply begins with the line `<!-- agent-land:review-response -->`, then the outcome line. Re-runs fetch comments and skip any thread whose root already has a descendant reply authored by the agent carrying the marker.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Mount contention** — a second child binding the same checkout corrupts it | **Sequential only.** `respond-review` binds the shared `agent-land` Mount one child at a time; the orchestrator binds no Mount; each child is `DELETE`d before the next. The server's single-writer 409 (no `--force`) is the hard backstop[^mount-design]. No parallel fan-out for this stage. |
| **Double-reply / re-addressing on re-run** | **Markers.** The `<!-- agent-land:review-response -->` prefix marks every agent reply; re-runs skip threads that already carry one. Git work is idempotent (a no-op produces no commit), and re-requesting an already-requested reviewer is a harmless no-op. Precedent: the pipeline trigger's `Orchestrator started` marker[^trigger-learn]. |
| **Over-eager changes** — the agent "fixes" beyond the review or makes a decision it shouldn't | **Escalate-don't-decide** for anything contradicting an ADR, requesting a design/interface/architecture decision, or changing scope[^ticket-loop]; changes are limited to addressing the comments; ADR 011 budgets bound the work[^adr-011]. |
| **Token scope** — can't post replies / re-request / push | **First-run probe** of `GET /repos/{owner}/{repo}` `.permissions` before work; if `pull_requests` or `push` is missing, escalate. The `.github/workflows` push-permission limitation from the first orchestrated run is an adjacent, separate issue and does not apply to review replies[^orch-learn]. |
| **Fabricated or wrong re-request** — inventing reviewers, re-requesting bots | **Parse only actual reviewers** from the review and the PR object; filter bots; skip re-request when there is no explicit human reviewer and report it. |
| **Settling without finishing** — `agent_settled` ≠ task done | **Verify the deliverable before settling**: PR pushed, replies posted, re-request issued, CI green. One-shot per wave; re-invoked per wave — never a silent half-done settle[^orch-learn]. |
| **Budget exhaustion mid-loop** | Bounded `maxAttempts` + escalate-to-human park on exhaustion (ADR 011 soft budgets, post-settle accounting)[^adr-011]. |

## ADR pointers

**No new ADR is required.** The change is composition-only:

- The `respond-review` **stage kind is a `policy.yaml` addition** — a prompt-level recipe artifact, not an engine surface — under ADR 017 (product layer on OKF memory, pipeline outside the engine)[^adr-017].
- **Budgets** reuse ADR 011's soft, orchestrator-side enforcement[^adr-011].
- The **Mount single-writer invariant** is unchanged — sequential binding is pure composition[^mount-design].
- **Identity, loopback, and exact-name resolution** reuse the git-identity, Platform Connector, and orchestrator recipes as-is[^git-identity-design][^platform-connector-design][^orchestrator].

A new ADR is flagged **only if** the stage-kind/policy change is judged architecturally contested — it is not: `policy.yaml` declares stage kinds for the orchestrator recipe, and adding an entry adds no engine surface and no new primitive.

## Minimal change set

- `agent-image/skills/respond-to-review/SKILL.md` — **new**; the recipe (Part 1).
- `.opencode/skills/respond-to-review/SKILL.md` — **new**; the laptop-side mirror.
- `agent-image/skills/orchestrator/policy.yaml` — add the `respond-review` stage entry (Part 2).
- `agent-image/skills/orchestrator/SKILL.md` — one-line addition of `respond-review` to the prose stage-kind list in "Compose the plan" (the policy is authoritative; this keeps the recipe's own list accurate).

**Zero engine/CLI changes** — no `packages/server`, `packages/contracts`, or `packages/cli` edits; no new endpoints; no new ADR; no new connector (the write-capable `github` connector already exists).

## Answers to the Feature note's open questions

1. **Stage-kind vs. re-prompt — decided: a new `respond-review` stage kind.** Not a re-prompt of `implement`. Exact entry: `connectors: [github]`, `mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]` (sequential), `budget: { timeoutSec: 1800, maxTokens: 200000, maxCost: 2.00 }`, `retry: { maxAttempts: 2, on: [failure, stall] }`, `leadsToGate: merge`.
2. **Standalone vs. stage, one recipe — decided: one skill, two invocations.** PR identified by number in the prompt (stage: orchestrator passes it; standalone: operator names it). Standalone no-number convenience: discover the single open PR on the current branch. The Mount target differs (standalone operator checkout vs. the stage child's shared `agent-land` Mount); identity and `--repo` are identical (§Interfaces).
3. **"Each review thread" — decided.** In scope: inline review comments, PR reviews (distinguishing blocking `CHANGES_REQUESTED` from incidental), and general comments. Threads group by `in_reply_to_id`; reply per inline thread via `POST .../pulls/{n}/comments/{id}/replies`. A `CHANGES_REQUESTED` review with no inline threads gets **one** summary general comment. Per-thread replies are required; a single summary review does not substitute.
4. **Re-request semantics — decided.** `requested_reviewers` only (`gh pr ready` clears draft and does nothing else). Re-request the original reviewer(s) parsed from the review's `user` + the PR's `requested_reviewers`/`requested_teams`; filter bots; if none (CODEOWNERS/team), skip and report.
5. **Deferral policy — decided.** Defer = no code change + reasoning recorded in the thread reply (question answered, nit declined, already addressed elsewhere, out of scope). **Escalate-don't-decide** = a comment contradicting an ADR, asking for a design decision, or changing scope parks to a human — never silently closed, never "fixed".
6. **Idempotency / re-run safety — decided.** The `<!-- agent-land:review-response -->` marker as the first line of every agent reply; re-runs skip threads with an existing marker reply. Git and re-request are naturally idempotent.
7. **Loop termination — decided: one-shot per feedback wave.** The stage addresses the wave it was given, settles as done, and is re-invoked by the operator (standalone) or the orchestrator at the merge gate (stage). No watch-and-loop within a session.
8. **Scope of permitted changes — decided.** Only changes that address the comments, bounded by `pnpm typecheck`/`pnpm test`/`gh pr checks --watch` and ADR 011 budgets. A comment implying a new ADR/interface/architecture means *escalate, don't decide*.
9. **Token/connector permissions — decided.** The write-capable `github` connector's repo scope covers posting replies and `requested_reviewers`; verified up front by a `GET /repos/{owner}/{repo}` `.permissions` probe. The `.github/workflows` push limitation is adjacent and out of scope.
10. **Skill home & naming — decided.** `agent-image/skills/respond-to-review/SKILL.md` (canonical, bundled) + `.opencode/skills/` mirror. It composes the dev-playbook and github skills; it stands alone as a skill rather than extending dev-playbook.
11. **Note-shaped deliverable — decided (carried from the Feature note).** Yes: a product Feature + Design pair even though the implementation is recipe-only[^adr-017]. Nothing in the engine changes.

[^feature]: [Review Response Feature note](/product/features/review-response.md)
[^dogfooding]: [Dogfooding — the agent-land playbook](/playbook/dogfooding.md) — Phase 3, the gap table, rule 5
[^engine]: [Agent Land engine](/platform/engine.md) — six primitives, composition only
[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md) — composition outside the engine
[^mount-design]: [Mount design](/product/designs/mount-design.md) — single-writer invariant, hard/409
[^platform-connector-design]: [Platform Connector design](/product/designs/platform-connector-design.md) — loopback, ephemeral per-session auth
[^dynamic-orchestration-design]: [Dynamic orchestration design](/product/designs/dynamic-orchestration-design.md) — stage kinds, budgets, retries; the policy file is closed
[^git-identity-design]: [Git identity injection](/product/designs/git-identity-design.md) — connector-wins identity
[^dev-playbook]: [Dev playbook](agent-image/skills/dev-playbook/SKILL.md) — the branch → green-PR loop
[^orchestrator]: [Orchestrator recipe](agent-image/skills/orchestrator/SKILL.md) — planner discipline, Mount ownership
[^policy]: [Orchestrator policy](agent-image/skills/orchestrator/policy.yaml) — stage kinds, budgets, retries
[^ticket-loop]: [Ticket loop](/playbook/ticket-loop.md) — decision rule #1, advance-to-the-gate discipline
[^adr-011]: [ADR 011 — per-run kill switch](/adrs/011-kill-switch.md) — per-run budgets (soft enforcement)
[^adr-017]: [ADR 017 — product layer on OKF memory](/adrs/017-product-layer-okf-memory.md) — product memory, pipeline outside the engine
[^trigger-learn]: [Scheduled pipeline trigger](/learnings/scheduled-pipeline-trigger.md) — marker-based dedupe
[^orch-learn]: [First orchestrated run](/learnings/first-orchestrated-run.md) — exact connector names, verify against live state
