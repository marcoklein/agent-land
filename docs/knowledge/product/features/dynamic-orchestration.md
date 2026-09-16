---
type: Feature
title: Dynamic Orchestration
description: The orchestrator plans a per-task stage graph from prompt-level policy instead of running a fixed script — skip or deepen research, fan out parallel work, spawn reviewers, assign models per stage, all bounded by an aggregate run budget.
status: stable
tags: [orchestration, multi-agent, composition]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-05T17:21:18Z }
verified: { by: human:marcoklein, at: 2026-09-06T00:00:00Z }
sources:
  - id: roadmap
    resource: /playbook/multi-agent-workflow.md
    title: Multi-agent workflow — Phase 4
  - id: pipeline
    resource: /product/pipeline.md
    title: The product pipeline — three human gates
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
---

# Dynamic Orchestration

Phase 4 of the [multi-agent roadmap](/playbook/multi-agent-workflow.md): the orchestrator plans its own stage graph per task from prompt-level policy — a declaration of roles, tools, gates, budgets, and models — instead of following the fixed `research → refine → design → critic` script. No engine change — the six primitives are unchanged; the graph semantics live in the orchestrator recipe.

## Why

The static orchestrator treats every task identically: always researches, always designs, always reviews — sequentially, one child per stage, one model. Phase 4 gives it a planner's judgment: skip or deepen research, fan out parallel children on per-child Mounts, spawn adversarial reviewers, retry failed stages with adjusted prompts, and pick a model per stage — all while holding an aggregate run budget so fan-out doesn't run away. The proof is a dogfood task whose stage graph visibly differs from the static default but clears the three human gates at matching quality[^dogfooding].

## User stories
- As an operator, I want the orchestrator to **skip research** when an issue is well-specified.
- As an operator, I want the orchestrator to **fan out parallel work** on per-child Mounts for independent subtasks.
- As an operator, I want the orchestrator to **spawn an adversarial reviewer** before I see a design.
- As an operator, I want the orchestrator to **retry a failed stage** with an adjusted prompt, unprompted.
- As an operator, I want the orchestrator to **pick a model per stage** — cheap for research, strong for design.
- As an operator, I want to **inspect the plan before it runs**, so I can veto or adjust the graph.

## Acceptance criteria

- The orchestrator **emits an inspectable plan** before executing — a stage-graph declaration posted to the issue.
- **Skip-research, deepen-research, fan-out, retry-with-adjusted-prompt, adversarial-review, and per-stage model** are each reachable from policy, not hard-coded. No engine change — composes Sessions, Mounts, Providers, and the Platform Connector[^engine].
- The three human gates remain `waiting_for_input` parks; a dynamic graph may reorder or reshape stages but never remove, merge, or bypass a gate[^pipeline].
- An aggregate run budget bounds the fan-out; per-child kill switches cap each stage. Soft orchestrator-side budgets with hard server-side enforcement reserved for ADR 011 follow-up.
- **Deliverable:** a dogfood task whose executed graph **visibly differs** from the static default and clears the three gates with no more human correction than the baseline.

## Open questions

1. **Plan contract.** Where does the plan live — a JSON artifact posted to the issue before execution? Is it a new gate?
2. **Parallelism vs. Mount invariant.** One Mount per child (pure composition) or soften the invariant? How are worktrees seeded and reconciled across parallel branches?
3. **Retry policy.** Failure vs. stall vs. escalate-to-human — max attempts, how prompts adjust, how budgets bound the loop.
4. **Model policy.** Where lives the per-stage model policy and are models selected by name or capability at child-create?
5. **Observability.** Children are deleted to free Mounts; where does the executed graph live for post-mortem?
6. **Adversarial reviewer discipline.** Always spawned or per-plan? How does its report feed back into the stage without crossing into merge rights?

[^roadmap]: [Multi-agent workflow](/playbook/multi-agent-workflow.md) — Phase 4 spec
[^pipeline]: [The product pipeline](/product/pipeline.md) — three human gates
[^engine]: [Agent Land engine](/platform/engine.md) — six primitives, composition only
[^dogfooding]: [Dogfooding strategy](/playbook/dogfooding.md)
[^mount]: [Mount design](/product/designs/mount-design.md) — single-writer invariant