---
type: Feature
title: Phase 4 Defect Fixes
description: Fix the three defects uncovered by the first dynamic-orchestration dogfood run — a bash heredoc bug, a Dokku deploy-lock race, and a budget-accounting metric trap — without engine changes.
status: draft
tags: [orchestration, dogfooding, defect, budget, deployment]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-13T00:00:00Z }
sources:
  - id: learnings
    resource: /learnings/first-dynamic-orchestration-run.md
    title: First dynamic-orchestration run — the source of all three defect reports
  - id: design
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration Design note — the accepted design the fixes must stay within
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the six primitives
  - id: kill-switch
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: product-adr
    resource: /adrs/017-product-layer-okf-memory.md
    title: Build a Product Layer on OKF Memory with an Agentic Pipeline
  - id: orchestrator-skill
    resource: agent-image/skills/orchestrator/SKILL.md
    title: The planner recipe — carries defect 1 (already fixed) and defect 3 (budget enforcement logic to change)
  - id: policy
    resource: agent-image/skills/orchestrator/policy.yaml
    title: Orchestrator policy — per-stage and run-level budget declarations
  - id: plan-mjs
    resource: agent-image/skills/orchestrator/plan.mjs
    title: Plan validator — computeAggregateBudget and isBudget functions
  - id: plan-schema
    resource: agent-image/skills/orchestrator/plan.schema.json
    title: Plan artifact contract — budget $def requires maxTokens ≥ 1
  - id: deploy-workflow
    resource: .github/workflows/deploy.yml
    title: Deploy workflow — defect 2 fix lives here
  - id: deployment-gotchas
    resource: /learnings/deployment.md
    title: Deployment gotchas — self-deploy hazard context
---

# Phase 4 Defect Fixes

Fix the three defects the first [dynamic-orchestration dogfood run](/learnings/first-dynamic-orchestration-run.md) (issue #79) uncovered. Defects 1 and 2 already appear to have their fixes landed in the repo; defect 3 — the budget-accounting metric trap where `totalTokens` (cumulative context tokens) grossly overstates billable spend — is the remaining substantive change. This is a **product-layer correction**, not an engine change: the orchestrator recipe, its policy/plan artifacts, and the deploy workflow are the only files touched[^product-adr].

## Fit-check

This is a **bug-fix within the accepted design**, not a new feature. It passes both gates in the refine stage:

**Boundary** — no server code, no `packages/contracts` or `packages/server` changes[^engine]. The fixes are confined to the product layer: the orchestrator recipe and its policy/plan artifacts, and the deploy workflow. This follows [ADR 017](/adrs/017-product-layer-okf-memory.md) (product layer on OKF memory, pipeline outside the engine) and the [dynamic orchestration design note](/product/designs/dynamic-orchestration-design.md)'s "no engine change" boundary verbatim. The [Mount single-writer invariant](/product/designs/mount-design.md) is unchanged — no fix touches the Mount lifecycle.

**Vision board** — the fixes serve the vision directly: *autonomy with trust* (the plan JSON must be inspectable at Gate 0; budgets must not false-trigger), *reusable working patterns* (the budget axis correction makes the recipe budget-safe for any future run), and platform velocity (serialized deploys mean burst-merges don't fail).

## Why

The first dynamic-orchestration dogfood run proved the planner works — it composed a visibly different stage graph, the three human gates held, and the execution trace was posted — but three defects broke observability, reliability, and budget accounting:

1. **Gate 0 plan was unreadable.** The orchestrator's `gh issue comment` used a heredoc with a nested `$(cat /tmp/plan.json)` that was never expanded, so the human saw the literal string `$(cat /tmp/plan.json)` instead of the actual plan JSON. Gate 0 — the pre-execution inspect-before-spawn checkpoint — was effectively blind.

2. **Burst merges broke deploys.** Merging three PRs in quick succession fired three concurrent `git push dokku` calls, and Dokku's single-deploy lock rejected two of them. The operator had to re-run the workflow manually.

3. **The orchestrator enforced budgets against `totalTokens`, not cost.** Pi's `message_end` `usage.totalTokens` is the cumulative context-token count across all turns — it includes every input token the model has ever seen in the session, not the billable output. The first dogfood run reported `totalTokens` of ~719k/760k/1.97M per stage against a 700k aggregate ceiling, which *looks like* the run blew the budget — but the actual billable cost was $0.03/$0.04/$0.05 (**$0.11 total** vs. $7.00 aggregate cost ceiling)[^learnings]. If the orchestrator enforced `maxTokens` against `totalTokens`, every multi-turn stage would false-trigger. Cost (or a provider output-token field) is the correct budget axis.

The first two defects are narrow implementation bugs with small, isolated fixes — a bash composition change and a workflow concurrency group. The third defect is a **schematic correction**: the budget accounting axis must pivot from `totalTokens` to `cost.total` across the plan schema, the validator, the policy, and the orchestrator's budget-enforcement loop.

## User stories

- As an operator, I want the **plan JSON to render at Gate 0**, so I can inspect the exact stages, budgets, and gate points before any child session is spawned.
- As an operator, I want **concurrent merges to deploy reliably**, so I don't have to re-run failed deploys after a burst of PRs lands.
- As an operator, I want **the orchestrator to enforce budgets against billable cost**, not cumulative context tokens, so a stage that stays in-budget on cost isn't killed because its context grew across turns.

## Acceptance criteria

1. **Defect 1 (plan-comment heredoc) — verified resolved.** Every `gh issue comment` site in `agent-image/skills/orchestrator/SKILL.md` uses `--body-file` or an equivalent pattern that does not nest a command substitution inside a heredoc. The Gate 0 plan comment and the completion execution-trace comment both render actual JSON, not literal `$(cat …)` strings.

2. **Defect 2 (Dokku deploy-lock race) — verified resolved.** `.github/workflows/deploy.yml` uses a `concurrency: dokku-deploy` group with `cancel-in-progress: false`, and the retry loop (600s, 20s sleep) serves as defense-in-depth. A burst of three merges to `main` results in three successful serial deploys, not two failures.

3. **Defect 3 (budget metric trap) — changed.** The orchestrator enforces budgets against `message.usage.cost.total` (billable cost), not `message.usage.totalTokens` (cumulative context tokens). Specifically:
   - `agent-image/skills/orchestrator/SKILL.md` — `collect_usage` and the soft-budget enforcement loop compare `cost.total` against `maxCost`, not `totalTokens` against `maxTokens`. The budget-gate logic in the execute phase (step 1: "Budget gate") uses cost as the primary axis.
   - `agent-image/skills/orchestrator/policy.yaml` — per-stage `budget` declarations and `runBudget` still carry `maxTokens`/`maxCost`/`timeoutSec`, but `maxTokens` is re-scoped: either **dropped** (cost-only enforcement), **made optional** (0 or absent = "not enforced"), or kept as an **informational ceiling** with no kill teeth.
   - `agent-image/skills/orchestrator/plan.schema.json` — the `budget` `$def` reflects the decision on `maxTokens` (optional, removed, or informational).
   - `agent-image/skills/orchestrator/plan.mjs` — `isBudget` and `computeAggregateBudget` reflect the decision. If `maxTokens` is dropped, `computeAggregateBudget` no longer sums it; if it's made optional, the validator tolerates 0 or missing.
   - `docs/knowledge/product/designs/dynamic-orchestration-design.md` — the risk section ("Soft budgets are not hard stops" and the ADR 011 limitation note) is updated to record the pivot from `totalTokens` to `cost.total`.

4. **No engine change.** No `packages/contracts` or `packages/server` files are touched. Hard server-side kill-switch enforcement remains [ADR 011](/adrs/011-kill-switch.md) future work.

5. **Backward compatibility.** The plan artifact contract (`planVersion: 1`) either stays at version 1 with a non-breaking schema change (e.g., `maxTokens` made optional with a default), or — if `maxTokens` is removed — bumps to `planVersion: 2` with the Design note recording the migration.

## Open questions

These are the decisions the design gate must answer before implementation begins:

1. **Which metric replaces `maxTokens` for budget enforcement?**
   - **Cost-only?** Drop `maxTokens` from the budget schema; enforce only `maxCost` against `message.usage.cost.total`. Simplest change, but loses token-based ceilings entirely. If pi stops emitting `cost`, enforcement degrades to wall-clock only — the same limitation already accepted in [ADR 011](/adrs/011-kill-switch.md)[^kill-switch].
   - **Switch `maxTokens` to output/completion tokens?** Depends on whether pi's `message_end` `usage` object exposes `outputTokens` / `completionTokens` distinct from `totalTokens`. The [learnings note](/learnings/first-dynamic-orchestration-run.md) says "use cost or provider output-token fields as the budget axis" — we need to confirm the available fields. If output tokens are not available, this option is off the table.
   - **Multi-axis: cost as primary, `maxTokens` as informational?** Keep `maxTokens` in the schema but enforce only `maxCost` in the orchestrator loop. `maxTokens` becomes a human-readable ceiling with no kill teeth. Preserves the schema shape (no migration), but `plan.mjs` budget validation would still sum `maxTokens` for aggregate checks that are never enforced — misleading.

2. **What happens to `plan.mjs` `computeAggregateBudget` and `isBudget`?** If `maxTokens` is dropped or made optional, the aggregate budget computation must change. The `isBudget` validator currently requires `maxTokens ≥ 1`. Should it become optional (0 or absent = "not enforced"), or should the field be renamed to something like `tokenCeiling` to signal it's informational?

3. **Is this a `planVersion: 2` bump?** If `maxTokens` is removed from the required fields, the existing `plan.json` contract (`planVersion: 1`) changes. Is this a breaking change (version bump) or a non-breaking one (field made optional, existing plans still validate)?

4. **Should the dynamic-orchestration-design.md be amended as part of this fix?** The [design note](/product/designs/dynamic-orchestration-design.md) risk section already says: "If budget enforcement moves off `totalTokens` to cost, note it in the design-note risk section." Should this fix include an amendment to the design note, or is the learnings note sufficient?

5. **Verification strategy.** The first dogfood run showed `totalTokens` of ~719k/760k/1.97M per stage vs. actual cost of $0.03/$0.04/$0.05. How do we verify the fix is correct — re-run issue #79 with the corrected budget axis and confirm no false-trigger, or rely on the next pipeline-ready issue as the verification run?

6. **Defect 1 completeness.** The SKILL.md now uses `--body-file /tmp/plan-comment.md` at Gate 0 and `--body-file /tmp/trace-comment.md` at completion. Are there any other `gh issue comment` or `printf` sites in the SKILL.md that still use the old heredoc-with-nested-substitution pattern?

7. **Defect 2 completeness.** The deploy.yml has both a `concurrency: dokku-deploy` group (`cancel-in-progress: false`) and a retry loop (600s timeout, 20s sleep). Is the retry loop still needed now that concurrency serializes, or is it defense-in-depth? What happens when three runs are queued and the oldest one succeeds — do the queued runs still push the same ref and no-op?

[^learnings]: [First dynamic-orchestration run](/learnings/first-dynamic-orchestration-run.md) — the source of all three defect reports
[^design]: [Dynamic Orchestration Design note](/product/designs/dynamic-orchestration-design.md) — the accepted design the fixes must stay within
[^engine]: [Agent Land engine](/platform/engine.md) — the [Session, Event Stream, and Platform Connector](/platform/engine.md#the-six-primitives) primitives the fixes compose from
[^kill-switch]: [ADR 011 — per-run kill switch](/adrs/011-kill-switch.md) — defines `totalTokens` and `cost.total` as the two signals pi emits
[^product-adr]: [ADR 017 — product layer on OKF memory](/adrs/017-product-layer-okf-memory.md) — the orchestrator is a product-layer recipe, not an engine feature