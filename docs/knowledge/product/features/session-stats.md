---
type: Feature
title: Session stats — tokens, cost, context %
description: Expose pi's get_session_stats (tokens, cost, context-window fill) through al status and JSON API to give operators real-time visibility into session economics for budget guardrails and orchestrator-driven budget enforcement.
status: draft
tags: [observability, cost, budget, cli, api]
generated: { by: opencode/claude-opus, at: 2026-09-18T00:00:00Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: kill-switch
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
  - id: dynamic-orchestration
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration Design
  - id: boundaries
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
---

# Session stats — tokens, cost, context %

## Why

Agent-land's operators need real-time visibility into session economics — token usage, LLM cost, and context-window fill percentage — to enforce the budget guardrails required by recurring maintenance phases and the dynamic orchestrator's per-stage + aggregate run-budget enforcement. Currently, pi's `get_session_stats` RPC call remains unused by the platform. This work exposes that data through two surfaces: (1) an `al status` CLI command for operators to query live or post-hoc, and (2) a JSON/SSE API endpoint that the orchestrator and external systems can consume. This is the soft-accounting precursor to the hard kill-switch (ADR 011) and the foundation for the orchestrator's spend-aware decisions in Phase 4 dynamic orchestration.[^kill-switch][^dynamic-orchestration]

## User stories

- As an operator, I want `al status <session-id>` to print token usage, cost, and context-fill percentage so I can spot spend trends and diagnose runaway sessions before they hit hard limits.
- As an operator, I want the stats to work for both live and stopped sessions so I can review a completed session's final spend without keeping it running.
- As the dynamic orchestrator (an agent), I want to query session stats via `GET /api/sessions/:id` so I can observe per-stage budget consumption and decline over-budget retries without hard server-side enforcement.
- As an operator, I want `al status` to default to the current session (via `AGENT_LAND_SESSION_ID`) so I can check spend from within a running session without explicit IDs.

## Acceptance criteria

- `al status` (or `al status <session-id>`) prints a table with: tokens, cost (in platform currency, e.g., USD), context-fill percentage, and updated-at timestamp.
- Stats come directly from pi's `get_session_stats` RPC call, not calculated heuristically.
- The JSON/SSE API exposes the same data on `GET /api/sessions/:id/stats` (or as a `stats` field in `GET /api/sessions/:id`).
- Stats are queryable for both live and stopped sessions; stopped sessions retain their final `usage` payload and remain queryable indefinitely (or per the session retention policy).
- The CLI command is covered by tests and documented in `docs/knowledge/platform/cli.md`.
- Cost values are preserved from pi's `usage.cost` field with no server-side translation or rounding (delegation to the Provider and pi).

## Open questions

1. **Source of truth — pi's `get_session_stats` vs. event parsing.** Should the platform rely solely on pi's `get_session_stats` RPC (simpler, one call per query), or must it also expose aggregated snapshots from `message_end` events (finer-grained, useful for in-session mid-run budget warnings)? **Likely**: `get_session_stats` is the platform's source of truth; the orchestrator can parse `message_end` from the event log in real-time if mid-run sampling is needed (deferred to Phase 4).

2. **Scope — per-session vs. aggregate.** Is `al status <session-id>` sufficient, or must the feature also support `al status --aggregate <run-id>` for the orchestrator's run-level accounting? **Likely**: per-session is the core feature; aggregate views are an orchestrator-side concern (summing child sessions' stats).

3. **Operator identity and visibility.** Can the operator query stats for any session, or only sessions they own? (Currently the platform is single-operator; no multi-user auth exists.) **Likely**: any session is queryable; identity is enforced by the `AGENT_LAND_BASIC_AUTH` envelope.

4. **API contract shape.** Should `GET /api/sessions/:id/stats` be a separate endpoint returning `{ tokens, cost, context_percent, updated_at }`, or should stats grow a field in the existing `GET /api/sessions/:id` response? **Likely**: a separate endpoint is cleaner and avoids payload bloat on session list operations.

5. **Stopped session retention.** Must session stats persist after the session is stopped, and for how long? If sessions are garbage-collected, are stats lost? **Likely**: stats are part of the session record (flat JSON or event log) and survive until the session is deleted; retention policy is orthogonal (already defined by operational SLOs).

[^engine]: [Agent Land engine](/platform/engine.md)
[^kill-switch]: [Per-Run Kill-Switch](/adrs/011-kill-switch.md) — the hard enforcement layer this work enables.
[^dogfooding]: [Dogfooding playbook](/playbook/dogfooding.md) — "Know a session's cost/context fill" row documents the blocker.
[^dynamic-orchestration]: [Dynamic Orchestration Design](/product/designs/dynamic-orchestration-design.md) — Answers 4 (Budgets) explains how the orchestrator enforces per-stage + aggregate budgets via spend tracking.
