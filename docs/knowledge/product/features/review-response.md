---
type: Feature
title: Review Response
description: A playbook/recipe capability that reads PR review feedback via gh api, addresses each comment or defers it with reasoning, pushes fixes, replies per thread, and re-requests review — as a standalone prompt or an orchestrator stage. Closes dogfooding Phase 3. Composition only; no engine change; merge stays human-gated.
status: draft
tags: [playbook, recipe, dogfooding, review, github, orchestration, composition]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-17T22:02:00Z }
sources:
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
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
  - id: ticket-loop
    resource: /playbook/ticket-loop.md
    title: Ticket loop — decision rule #1, advance-to-the-gate discipline
  - id: adr-011
    resource: /adrs/011-kill-switch.md
    title: ADR 011 — per-run budgets (soft enforcement)
  - id: adr-017
    resource: /adrs/017-product-layer-okf-memory.md
    title: ADR 017 — product memory on OKF, pipeline outside the engine
---

# Review Response

The review-response capability. When a human leaves feedback on a PR, the agent reads it, addresses each comment (code change, doc update, or an explicit deferral with reasoning), pushes new commits, replies to each review thread, and re-requests review — all from a prompt like "respond to the review on PR #N", or as a pipeline stage the orchestrator spawns.

## Why

Dogfooding Phase 3 defines the deliverable as "a PR that goes red → review → green → merge with the agent driving the middle"[^dogfooding]. The gap table already records that responding to review comments "works via `gh api` to read + reply" — the missing piece is the trigger loop: **today the human re-prompts** between "PR opened" and "PR merged". This feature removes that last routine human nudge by making review-response a repeatable, invokable recipe rather than an ad-hoc re-prompt. The agent owns everything left of review and the middle turn of the review loop; the human is left with exactly the gates that stay theirs: plan/outcome/design review and, above all, the **merge gate**, which remains human-gated[^dogfooding].

This is a **playbook/recipe feature, not an engine feature**. It is composition-only: it reuses the six engine primitives (Connector, Provider, Mount, Session, Event Stream, Platform Connector)[^engine] exactly as they are. **Zero changes to `packages/server`, `packages/contracts`, or the CLI.** The implementation lands as a skill (`agent-image/skills/respond-to-review/SKILL.md` with a `.opencode/skills/` mirror) plus, at most, a new `respond-review` stage entry in the orchestrator [`policy.yaml`](agent-image/skills/orchestrator/policy.yaml). Dogfooding rule 5 is explicit: "the playbook is composition"[^dogfooding].

## User stories

- As an operator, I want to run a **standalone command** — "respond to the review on PR #N" — so a single prompt turns human feedback into pushed fixes, thread replies, and a re-requested review without me driving each step.
- As an orchestrator agent, I want to **spawn a `respond-review` stage child** when merge-gate feedback arrives, so review response slots into the pipeline as a stage rather than a manual re-prompt.
- As an operator, I want the agent to **defer a comment with explicit reasoning** when it should not act (e.g. it needs a human design decision), so it neither silently drops feedback nor "fixes" something that is actually a decision for me.

## Acceptance criteria

- Given a PR with review comments, the agent (or a stage child) reads them via `gh api` — inline review comments (`GET /repos/{owner}/{repo}/pulls/{n}/comments`), PR reviews including `CHANGES_REQUESTED` (`GET .../pulls/{n}/reviews`), and general PR/issue comments (`GET .../issues/{n}/comments`).
- It addresses each comment: code changes, doc updates, or an explicit deferral recorded with reasoning (never a silent drop).
- It pushes new commits and replies to each review thread via `POST /repos/{owner}/{repo}/pulls/{n}/comments/{id}/replies`.
- It re-requests review via `POST /repos/{owner}/{repo}/pulls/{n}/requested_reviewers` — **not** `gh pr ready`, which only clears draft status and does **not** re-request a reviewer.
- It works both as a standalone command and as a pipeline stage (the orchestrator can spawn a "respond-to-review" child), in both cases settling without merging.

## Open questions

Answers given here are the refine stage's recommended direction; the Design note must settle them concretely, and anything not answered here is explicitly deferred.

1. **Stage-kind vs. re-prompt.** Recommended: a **new `respond-review` stage kind** in `policy.yaml` — with `connectors: [github]`, the shared `agent-land` Mount (sequential), a budget + retry, and `leadsToGate: merge` — rather than re-prompting the existing `implement` stage. The stage-kind list is closed ("you never invent a kind")[^dynamic-orchestration-design], so adding one is a policy change the Design note must specify exactly. *Deferred: exact budget numbers and retry-on list.*
2. **Standalone vs. stage, one recipe.** One skill serves both. The PR is identified by number in the prompt (stage: orchestrator passes it; standalone: the operator names it). Recommended standalone convenience: with no PR number, discover the PR with unresolved review on the current branch. *Deferred: exact prompt contract and how `--repo`/Mount target differ between the two paths.*
3. **What counts as "each review thread".** In scope: inline review comments, PR reviews (distinguishing a blocking `CHANGES_REQUESTED` from incidental comments), and general comments. Threads group by `in_reply_to_id`/`reply_to`; reply per inline comment via the `.../comments/{id}/replies` endpoint. *Deferred: whether one summary review may substitute for per-thread replies, and the exact grouping rule.*
4. **Re-request-review semantics (must get right).** `gh pr ready` only clears draft; re-request is `POST /repos/{owner}/{repo}/pulls/{n}/requested_reviewers`. Recommended: parse the original reviewer(s) from the review and re-request them. *Deferred: behavior when there is no explicit reviewer (CODEOWNERS/team) or the reviewer is a bot.*
5. **Deferral policy.** A comment is deferrable when acting on it would exceed the agent's authority; the reasoning is recorded in the thread reply. **Escalate, don't decide**: a comment that contradicts an ADR, asks for a design-level decision, or changes scope must escalate to a human park, never be silently "fixed"[^ticket-loop]. *Deferred: the precise defer-vs-must-address rubric.*
6. **Idempotency / re-run safety.** Precedent is the trigger's marker discipline[^adr-017]. Recommended equivalent: check for an existing agent reply on a thread before posting (and skip already-addressed threads). *Deferred: exact marker format and placement.*
7. **Loop termination.** Recommended: **one-shot per feedback wave** — the stage addresses the comments it was given, settles as done, and is re-invoked (by the orchestrator or the operator) when the next review wave lands. It does not watch-and-loop within one session. *Deferred: who re-triggers — the orchestrator at the merge gate, or the standalone operator.*
8. **Scope of permitted changes.** Only changes that address the comments, bounded by the dev loop's verification (`pnpm typecheck`, `pnpm test`, `gh pr checks --watch`) and ADR 011 budgets[^adr-011]. A comment implying a new ADR/interface/architecture decision means *escalate, don't decide*[^ticket-loop].
9. **Token/connector permissions.** Confirm the write-capable `github` connector's token can post review replies and call `requested_reviewers` (repo scope). Commit identity comes from the connector-injected `GIT_USER_NAME`/`GIT_USER_EMAIL`; push via `x-access-token`; `gh` reads `GITHUB_TOKEN` via `GH_TOKEN`; never `gh auth login`[^git-identity-design]. *Deferred: the explicit verification step for this on the first run.*
10. **Skill home & naming.** Recommended: `agent-image/skills/respond-to-review/SKILL.md` (canonical, bundled) + a `.opencode/skills/` mirror, consistent with dev-playbook/orchestrator. It composes the dev-playbook loop rather than duplicating it.
11. **Note-shaped deliverable.** Yes — this is a product *feature* (Feature note now, Design note at the design gate) even though the implementation is recipe-only[^adr-017]. The Design note carries the concrete three-part spec: the skill, the orchestrator integration, and risks/mitigations. **No engine change is implied by any of this.**

## Composition and gates (explicit)

- **Composition only.** Connector (`github`), Mount (shared `agent-land` checkout, **sequential — at most one live session per Mount**, enforced by a 409 with no `--force`[^mount-design]), Session, Event Stream, and Platform Connector (ephemeral per-session auth when run as an orchestrator child[^platform-connector-design]). Zero changes to the engine or the CLI.
- **Merge stays human-gated.** The agent reads, addresses, pushes, replies, and *re-requests* review — it never merges, never approves its own PR, and never bypasses a gate. Review-response advances work up to the merge gate, exactly like the ticket-loop's "advance to the gate, park" discipline[^ticket-loop].

[^dogfooding]: [Dogfooding — the agent-land playbook](/playbook/dogfooding.md) — Phase 3, the gap table, rule 5
[^engine]: [Agent Land engine](/platform/engine.md) — six primitives, composition only
[^mount-design]: [Mount design](/product/designs/mount-design.md) — single-writer invariant, hard/409
[^platform-connector-design]: [Platform Connector design](/product/designs/platform-connector-design.md) — loopback, ephemeral per-session auth
[^dynamic-orchestration-design]: [Dynamic orchestration design](/product/designs/dynamic-orchestration-design.md) — stage kinds, budgets, retries; the policy file is closed
[^git-identity-design]: [Git identity injection](/product/designs/git-identity-design.md) — connector-wins identity
[^ticket-loop]: [Ticket loop](/playbook/ticket-loop.md) — decision rule #1, advance-to-the-gate discipline
[^adr-011]: [ADR 011 — kill switch](/adrs/011-kill-switch.md) — per-run budgets (soft enforcement)
[^adr-017]: [ADR 017 — product layer on OKF memory](/adrs/017-product-layer-okf-memory.md) — product memory, pipeline outside the engine
