---
type: Feature
title: Respond to Review
description: A playbook recipe that reads PR review feedback via gh api, addresses each comment (fix, doc update, or explicit deferral), pushes, replies per thread, and re-requests review — standalone or as an orchestrator stage. Closes dogfooding Phase 3.
status: draft
tags: [dogfooding, review, github, composition, recipe]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-17T14:49:49Z }
sources:
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
  - id: vision-board
    resource: /product/goals/vision-board.md
    title: Product vision board
  - id: mount
    resource: /product/features/mount.md
    title: Mount — the durable-storage primitive
  - id: mount-design
    resource: /product/designs/mount-design.md
    title: Mount design — single-writer invariant
  - id: platform-connector
    resource: /product/features/platform-connector.md
    title: Platform Connector — loopback spawn
  - id: ticket-loop
    resource: /playbook/ticket-loop.md
    title: Ticket loop — the dogfooding heartbeat
  - id: dynamic-orchestration
    resource: /product/features/dynamic-orchestration.md
    title: Dynamic orchestration — policy-governed stage graphs
---

# Respond to Review

A **playbook recipe**, not an engine feature. It closes the last human nudge in [dogfooding](/playbook/dogfooding.md) Phase 3: today the "Respond to review comments" row of the gaps table reads *"✅ Works — `gh api` to read + reply"* but the enabler is *"a trigger loop; today the human re-prompts."* This note specifies the recipe that removes that re-prompt — the agent reads a PR's review feedback via `gh api`, addresses each comment (a code change, a doc update, or an explicit deferral with reasoning), pushes new commits to the PR head branch, replies to each review thread, and re-requests review — triggered either by a standalone prompt ("respond to the review on PR #N") or as a stage the orchestrator spawns as a `respond-to-review` child. It is the reusable kernel the pipeline's `feedback:` re-run path and the ticket loop's priority-1 step ("address feedback, push") both consume[^pipeline][^ticket-loop]. Per [ADR 017](/adrs/017-product-layer-okf-memory.md) and the [domain boundary](/product/goals/boundaries.md), this composes the six primitives — no engine change, no new primitive, no in-core orchestration[^engine][^boundaries].

## Fit-check

- **Boundary** — passes. The recipe composes **Mount** (the repo checkout, bound sequentially)[^mount], **Session** (the agent), **Platform Connector** (loopback child spawn in the pipeline-stage form)[^platform-connector], **Connector** (`github`), and **Provider** (model) — it adds or changes none of the six primitives. The Mount single-writer invariant binds the stage sequentially (DELETE-before-next), never a shared live `.git`[^mount-design]. It violates no ADR (no in-core workflow executor per ADR 017; no presentation/vendor knowledge per ADR 016). Orchestration touches live in the existing [orchestrator policy](/product/features/dynamic-orchestration.md), which is already composition[^engine][^boundaries][^dynamic-orchestration].
- **Vision board** — passes. It serves *autonomy with trust* (runs unattended but the merge gate stays human), *your way of working, encoded* (a recipe beside `dev-playbook` and `orchestrator`), and the business goal of shrinking the operator's day to intake plus gate review[^vision-board].

## Why

When a human leaves review feedback on a PR, the agent can already read and reply with `gh api` — but a human must re-prompt it after every review round, so the gap between "PR opened" and "PR merged" still contains a manual nudge. This feature turns that nudge into a recipe: one prompt (or one orchestrator stage) drives the whole red → review → green → merge middle, leaving the human only the merge itself. It closes dogfooding Phase 3 and is the shared kernel for both the product pipeline's feedback re-run and the ticket loop's highest-priority step[^dogfooding][^ticket-loop].

## User stories

- As an **operator**, I want to run "respond to the review on PR #N" as a standalone command and have the agent read the review comments, address each one, push fixes, reply to every thread, and re-request review, so I don't re-prompt after each review round.
- As an **operator**, I want the orchestrator to spawn a `respond-to-review` child when a PR at the merge gate comes back with review feedback, so the agent drives the middle of the loop unattended and I only act at the gates.
- As an **operator**, I want review response to stop at the merge gate — reply and re-request are permitted, approve/merge/deploy are not — so trust stays earned and the human gate is never bypassed[^dogfooding].

## Acceptance criteria

- Given a PR carrying review feedback, the agent reads it via `gh api` (inline diff threads, general PR/issue comments, and review verdicts — see open question 3 for exact coverage).
- Each comment is **addressed** by one of: a code change, a doc update, or an **explicit deferral with reasoning** (minimum bar in open question 2).
- The agent pushes new commits to the PR **head branch** and replies once per review thread (no double-post — idempotency in open question 5).
- The agent **re-requests review** using the correct API semantics (`gh pr ready` plus `POST /repos/{o}/{r}/pulls/{n}/requested_reviewers`, draft/team/bot handling in open question 4).
- It works **both** standalone ("respond to the review on PR #N") **and** as a pipeline stage the orchestrator spawns (`respond-to-review` child).
- **Merge and approve stay human-gated**: the recipe replies, pushes, and re-requests — it never merges, never approves its own PR, never bypasses the outcome/design/merge gates[^pipeline][^dogfooding].
- The change set is **recipe-only**: new skill file(s) under `agent-image/skills/` (with a `.opencode/skills/` mirror), an [orchestrator policy](/product/features/dynamic-orchestration.md) stage kind + budget, and a `dogfooding.md` Phase-3-done edit — **zero engine/`packages/*` changes**[^boundaries].

## Open questions

1. **Trigger/surface.** What exactly is the prompt — a standalone `al run` one-shot, an issue + label, or an orchestrator policy stage? How do the standalone and pipeline-stage forms share **one** recipe without duplication?
2. **Address-vs-defer policy.** What counts as "addressed"? Who decides a comment is deferred rather than fixed, and what is the minimum bar for "explicit deferral with reasoning"? Is there a per-comment classification (must-fix / should-fix / nit)? Does a deferral open a follow-up issue ("gaps are tickets")[^dogfooding]?
3. **Review-surface coverage.** Inline diff comments (threads), general PR/issue comments, and whole-PR review verdicts (approve / request-changes bodies) are different GitHub objects. Which are read, which are replied to, and how are they grouped into "one reply per thread"?
4. **Re-request semantics.** `gh pr ready` only clears draft status; re-requesting a reviewer is `POST /repos/{o}/{r}/pulls/{n}/requested_reviewers`, while replying to a thread itself re-notifies. What does "re-request review" concretely mean, including team reviewers, bots, and draft PRs?
5. **Loop safety.** What stops an infinite respond/re-review cycle? Max attempts, budget, and when to escalate-to-human/park? How are replies made idempotent (no double-post to the same thread)?
6. **Relationship to the ticket loop.** Ticket-loop priority #1 already defines "address feedback, push." Is respond-to-review the single reusable kernel that both the pipeline orchestrator and the ticket-loop tick call[^ticket-loop]?

[^dogfooding]: [Dogfooding — the agent-land playbook](/playbook/dogfooding.md) — Phase 3 spec, the gaps table, dogfooding rules and trust ladder
[^pipeline]: [The product pipeline](/product/pipeline.md) — stages, the three gates, and the `feedback:` re-run path
[^engine]: [Agent Land engine](/platform/engine.md) — six primitives, invariants (esp. #1 single-writer), composition layer
[^boundaries]: [Agent Land domain boundary](/product/goals/boundaries.md) — fit-check: composition, not engine
[^vision-board]: [Product vision board](/product/goals/vision-board.md) — "is it worth building?" counterpart
[^mount]: [Mount](/product/features/mount.md) — durable-storage primitive; single-writer invariant
[^mount-design]: [Mount design](/product/designs/mount-design.md) — hard single-writer invariant, DELETE-before-next sequencing
[^platform-connector]: [Platform Connector](/product/features/platform-connector.md) — loopback child spawn/prompt/watch/delete
[^ticket-loop]: [Ticket loop](/playbook/ticket-loop.md) — priority-1 step is already "address feedback, push"
[^dynamic-orchestration]: [Dynamic orchestration](/product/features/dynamic-orchestration.md) — policy-governed stage graphs, budgets, retries
