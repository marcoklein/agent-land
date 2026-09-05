---
type: Feature
title: Dynamic Orchestration
description: The orchestrator becomes a planner — it composes a per-task stage graph from prompt-level policy instead of running the fixed research → refine → design → critic script.
status: draft
tags: [orchestration, multi-agent, pipeline, composition, dogfooding, roadmap]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-05T17:21:18Z }
sources:
  - id: roadmap
    resource: /multi-agent-workflow.md
    title: Multi-agent workflow — the phased roadmap
  - id: pipeline
    resource: /product/pipeline.md
    title: The product pipeline
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the purest form
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: vision-board
    resource: /product/goals/vision-board.md
    title: Product vision board
  - id: orchestrator-skill
    resource: agent-image/skills/orchestrator/SKILL.md
    title: The static orchestrator recipe (Phase 2)
  - id: mount-design
    resource: /product/designs/mount-design.md
    title: Mount design — single-writer invariant
  - id: kill-switch
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: providers-adr
    resource: /adrs/015-providers-as-config-records-projected-into-pi.md
    title: Providers are config records projected into pi
  - id: product-adr
    resource: /adrs/017-product-layer-okf-memory.md
    title: Build a Product Layer on OKF Memory with an Agentic Pipeline
  - id: dogfooding
    resource: /dogfooding.md
    title: Dogfooding — developing agent-land on agent-land
---

# Dynamic Orchestration

Phase 4 of the [multi-agent roadmap](/multi-agent-workflow.md): the orchestrator stops following the fixed `research → refine → design → critic` stage list and **plans its own stage graph per task**. The "recipe" shifts from a scripted sequence to **prompt-level policy** — a declaration of roles, tools, gates, budgets, and models — and the orchestrator realizes that policy as child sessions over the loopback [Platform Connector](/engine.md#loopback).

## Fit-check

This is a **composition change, not an engine change**, and it passes both gates in the refine stage.

**Boundary** — dynamic orchestration adds *no* workflow executor to the engine. It reuses the six primitives unchanged[^engine]: the Platform Connector loopback for spawning/observing children, [Mount](/engine.md#capabilities-injected-at-session-creation) for per-child worktrees, [Provider](/engine.md#capabilities-injected-at-session-creation) records for per-stage model choice (already selectable at child create per [ADR 015](/adrs/015-providers-as-config-records-projected-into-pi.md)), and [ADR 011](/adrs/011-kill-switch.md) kill switches for per-child budgets. The graph semantics live entirely in the orchestrator recipe and its artifacts (plan documents, issue comments, PRs), exactly where [the domain boundary](/product/goals/boundaries.md) says control flow belongs. The one boundary-adjacent decision — parallel children against the Mount single-writer invariant — is either pure composition (one Mount per child) or a deliberate ADR amendment, surfaced as a scope decision in the Design note, never silently absorbed[^mount-design].

**Vision board** — the outcome serves the stated needs directly: *autonomy with trust* (the orchestrator makes routing calls, the human still holds the gates), *reusable working patterns* (the recipe becomes reusable policy), and the business goal of platform velocity (a dynamic graph should reach green PRs faster or with fewer human corrections than the static baseline)[^vision-board][^dogfooding].

## Why

The static orchestrator treats every task identically: it always researches, always refines, always designs, always reviews — sequentially, with one child per stage, inheriting a single default model. That wastes turns and spend on well-specified issues, can't shorten a task by splitting independent implementation work, and never brings a second pair of eyes to bear before a human reviews. Phase 4 gives the orchestrator a planner's judgment: skip or deepen research, split work into parallel children on per-child worktree Mounts, spawn adversarial reviewers, retry failed stages with adjusted prompts, and assign a model per stage (cheap for research, strong for design) — while holding an aggregate run budget so the extra fan-out doesn't run away. The proof is a dogfooded task on this repo whose stage graph visibly differs from the default pipeline yet produces artifacts that still clear the three human gates at matching quality.

## User stories

- As an operator, I want the orchestrator to **skip research** when the issue is already well-specified, so a turn and its cost aren't spent re-deriving what the issue already says.
- As an operator, I want the orchestrator to **split independent implementation work into parallel children** on per-child worktree Mounts, so a task finishes faster than strictly sequential stages allow.
- As an operator, I want the orchestrator to **spawn an adversarial reviewer** before I see a design, so weak or out-of-scope work is caught before it reaches a human gate.
- As an operator, I want the orchestrator to **retry a failed stage with an adjusted prompt**, so transient failures or a weak first attempt self-correct without a human re-prompt.
- As an operator, I want the orchestrator to **assign a model per stage** (cheap for research, strong for design), so spend follows the difficulty of the stage.
- As an operator, I want to **inspect the plan before it runs**, so a per-task stage graph can be vetoed or adjusted before any child session starts.
- As an operator, I want the three human gates to remain exactly where they are — outcome, design, merge — regardless of how the graph is shaped, so a dynamic planner can't remove or bypass a gate[^pipeline].

## Acceptance criteria

- The orchestrator, given a `pipeline-ready` issue, **emits an inspectable plan before executing** — a per-task stage-graph declaration (stages, order, per-stage role/tools/model/budget, and the gate points) posted to the issue so a human can veto or amend it.
- Each of **skip-research, deepen-research, parallel fan-out, retry-with-adjusted-prompt, adversarial-review, and per-stage model choice** is reachable from prompt-level policy in the orchestrator recipe — not hard-coded control flow — and can be observed in a real run.
- **No engine change**: the delivered change composes [Sessions, Mounts, Providers, and the Platform Connector](/engine.md) and adds no DAG/workflow executor, no in-core workflow vocabulary, and no vendor catalog (fails the fit-check otherwise)[^boundary].
- **Gate discipline holds**: the three human gates remain `waiting_for_input` parks; a dynamic graph may reorder or reshape stages but may not remove, merge, or bypass a gate[^pipeline].
- **Budgets bound the fan-out**: each stage/child carries a per-run [kill switch](/adrs/011-kill-switch.md) budget and the orchestrator holds an aggregate run budget, so retries and parallelism don't multiply spend without limit.
- **Deliverable**: a dogfood task on this repo whose executed stage graph **visibly differs from the static default** (e.g. research skipped, or a parallel implementation split, or an adversarial reviewer added) **and** whose artifacts still clear the three human gates with **no more human correction than the static baseline** — measured against the [dogfooding success signals](/dogfooding.md).

## Open questions

The Design note must answer these; each is sharpened because the graph is no longer a fixed list.

1. **The plan's home and contract.** Is the planner's output a per-task plan artifact (JSON/prompt) posted to the issue *before* execution for human veto, or emergent behavior inside the orchestrator's reasoning? How is "which stages run, in what order, with which model and budget" made inspectable — and is the plan itself a new gate?
2. **Parallelism vs. the single-writer invariant.** Do parallel children each get their own Mount holding a git worktree (pure composition), or does the invariant soften to allow multiple live sessions per Mount (an ADR amendment)? If one-mount-per-child: how are worktrees seeded from a shared repo without a shared live `.git` (independent clones vs. `git worktree add` from a shared seed vs. `clone --reference`), and how are parallel branches reconciled without clobbering[^mount-design]?
3. **Retry policy.** What counts as *failure* (retry with adjusted prompt) vs. *stall* (re-prompt with numbered steps) vs. *escalate-to-human*? Max attempts per stage, how prompts adjust between attempts, and how ADR 011 budgets bound the loop.
4. **Budgeting.** How are kill-switch budgets assigned per stage/child and aggregated into a total-run budget held by the orchestrator, given each child carries its own `KillSwitch`?
5. **Model policy.** Where does the per-stage model policy live, and how are models chosen at child-create time (ADR 015) — by name or by capability? What is the fallback when a chosen model/provider is absent?
6. **"Visibly differs" and "matching quality".** What minimal, demonstrable deviation counts, and how is "matching quality" measured against the static baseline (gates pass, ≤ baseline's human corrections, dogfooding success signals)?
7. **Observability of a dynamic graph.** Children are currently `DELETE`d to free the Mount, so a fanned-out graph loses the durable session tree (`al ls --tree`). Where does the executed graph live for post-mortem — kept-alive children, the plan artifact, issue comments, or a learnings note — and what does the human see at each gate[^orchestrator-skill]?
8. **Adversarial reviewer discipline.** Always spawned or only when the plan calls for it? How does its report route back to revise a stage, and how does it stay advisory (trust ladder — advises, never merges, never comments on PRs beyond its report)[^dogfooding]?
9. **Gate discipline under dynamic planning.** How are the three human gates represented when stages aren't a fixed list — does the planner declare gate points explicitly, and can it ever merge/skip a gate? (Expected answer: no.)
10. **State across redeploys.** Where does the dynamic plan + progress persist (session event history, issue comments, both)? Already open in the roadmap; sharper once the graph isn't a fixed list[^roadmap].

[^roadmap]: [Multi-agent workflow](/multi-agent-workflow.md) — Phase 4 spec and open questions
[^pipeline]: [The product pipeline](/product/pipeline.md) — the three human gates
[^engine]: [Agent Land engine](/engine.md) — six primitives, everything else is composition
[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md) — fit-check for the refine stage
[^vision-board]: [Product vision board](/product/goals/vision-board.md) — "is it worth building?"
[^orchestrator-skill]: [The static orchestrator recipe](agent-image/skills/orchestrator/SKILL.md) — the recipe to replace; note its explicit deferrals of per-stage model choice and parallelism
[^mount-design]: [Mount design](/product/designs/mount-design.md) — hard single-writer invariant, "amend to soft+`force` only if a concrete fan-out use case emerges"
[^dogfooding]: [Dogfooding strategy](/dogfooding.md) — trust ladder rule 4, success signals
