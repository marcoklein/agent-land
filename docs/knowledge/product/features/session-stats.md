---
type: Feature
title: Expose session cost and context stats via `al status`
description: Expose pi's `get_session_stats` (tokens, cost, context-fill %) through `al status` CLI and the JSON/SSE API so operators can observe spend and context pressure — a prerequisite for budget guardrails and orchestrator budget enforcement.
status: draft
tags: [cli, observability, session, budget, kill-switch]
generated: { by: opencode/claude-3.5-sonnet, at: 2026-09-16T00:00:00Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: cli
    resource: /platform/cli.md
    title: CLI (`al`)
  - id: cli-observability-design
    resource: /product/designs/cli-observability-design.md
    title: CLI session observability design (al log --json, al status)
  - id: kill-switch-adr
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: dynamic-orchestration-design
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic orchestration — multi-stage runs with adaptive budgets
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
---

# Expose session cost and context stats via `al status`

## Why

The dogfooding playbook surfaces an observability gap: operators cannot see a running or stopped session's token spend, cost, or context-fill percentage — essential signals to predict timeout/cost kills before they strike and to enable budget guardrails[^kill-switch-adr]. pi's `get_session_stats` RPC provides this data but is never surfaced to the operator. The killer issue is that the orchestrator (dynamic-orchestration-design) needs to read each child's stats to enforce aggregate-run budgets and refuse to spawn a child that would exceed the per-stage budget ceiling[^dynamic-orchestration-design]. Without stats exposure, budget enforcement is invisible, untestable, and unoperationalizable.

This is not a pretty-dashboard feature; it is the missing link between pi's capability and the operator's ability to see and enforce spend.

## User stories

- As an operator, I want `al status <id>` to show token usage, cost (USD), and context-fill % for both live and stopped sessions, so I can predict budget kills before they happen and detect overspend.
- As the orchestrator, I want to read each child session's stats (tokens, cost, context-fill) via a queryable API so I can enforce the aggregate run budget and refuse to spawn a child that would exceed the remaining per-stage budget ceiling.
- As an agent dogfooding itself, I want stats to be observable from the CLI so I can watch my own children's cost and context pressure in real time.

## Acceptance criteria

- `al status <id>` displays token usage (total, input, output), cost in USD, and context-fill percentage in human-readable format.
- `al status <id> --json` includes a `stats` object with numeric fields: `{ tokens: <n>, inputTokens: <n>, outputTokens: <n>, cost: <decimal>, contextFill: <percent> }`.
- Stats work for both live sessions (current usage snapshot) and stopped sessions (settled, final values).
- The JSON/SSE API exposes stats via a documented route (decision deferred to design stage: dedicated endpoint vs. embedded in `GET /api/sessions/:id` vs. event-stream projection).
- Stats data is sourced from pi's `get_session_stats` RPC or event-stream parsing (implementation choice at design stage).
- CLI tests cover stats rendering for both human and JSON modes; integration test verifies live-session snapshot behavior.
- `docs/knowledge/platform/cli.md` documents `al status` stats output and JSON shape.

## Open questions

- **Stats data surface:** Which fields from pi's `get_session_stats` do we expose?
  - Input tokens, output tokens, total tokens, cost (USD)?
  - Context-fill percentage (context-used / context-limit)?
  - Per-turn breakdown or cumulative only?
  - Are these snapshots (live-so-far for running sessions) or settled (final for stopped)?

- **Live vs. stopped session semantics:**
  - For a running session mid-turn, does stats reflect the current turn's in-flight usage, or only completed turns?
  - For a stopped session, are stats final and stable? How long are they retained?
  - For a waiting-for-input session, does it have settled stats for all turns up to the wait point?

- **Implementation path (no server code vs. minimal server code):**
  - **Option A (no server change):** CLI replays the event stream (pattern from cli-observability-design for last message), parsing all `message_end` events to extract and sum `usage`. Matches existing pattern; no server work.
  - **Option B (minimal server change):** Server adds a `GET /api/sessions/:id/stats` endpoint that calls pi's `get_session_stats` RPC directly. Clean API surface, but requires server work.
  - **Option C (schema extension):** Add a `stats` field to the `Session` record schema (contracts/session.ts) and populate it on every fetch. Tightest integration, but blurs the line between record (fixed at create-time) and runtime observables.
  - Which option serves the orchestrator's needs (reliable, queryable, eventually-consistent ok) and the operator's needs (responsive, correct)?

- **API surface:**
  - Dedicated `GET /api/sessions/:id/stats` endpoint returning `{ tokens, cost, contextFill }`?
  - Embedded in `GET /api/sessions/:id` as a `stats` sub-object on the `Session` record?
  - Projected into the event stream as periodic `session_stats` events?
  - Does the choice affect the orchestrator's polling/subscription pattern (see dynamic-orchestration-design §Interfaces 3)?

- **CLI output shape:**
  - Human-readable lines: `tokens: <n>`, `cost: $<amount>`, `context fill: <percent>%`?
  - Does this extend the `al status` output specified in cli-observability-design, or replace it?
  - JSON shape: are all three fields required, or optional depending on session state (e.g., no `contextFill` if context limit is unknown)?

- **Orchestrator integration point:**
  - Does the orchestrator read stats via the API (new endpoint) or by watching `message_end` events from its child sessions' event streams (pattern already in dynamic-orchestration-design)?
  - If API, how often does the orchestrator poll?
  - Is there a sync issue if stats are eventually-consistent (e.g., returned by a delayed RPC)?
  - Does the orchestrator need stats only for budget enforcement, or also for observability dashboards?

## Cross-links

- **Engine:** [Agent Land engine — the purest form](/platform/engine.md) — event stream is the single observation channel; sessions are observable, not interpreted.
- **Existing design:** [CLI session observability design](/product/designs/cli-observability-design.md) — specifies `al status <id>` output (status, mounts, connectors, last message); this note extends it with stats columns.
- **Kill-switch ADR:** [Per-Run Kill-Switch](/adrs/011-kill-switch.md) — defines per-run budgets (timeout, maxTokens, maxCost) and soft-enforcement via `message_end` event usage. This feature provides operator visibility into the budgets being enforced.
- **Orchestrator design:** [Dynamic orchestration — multi-stage runs with adaptive budgets](/product/designs/dynamic-orchestration-design.md) — orchestrator holds aggregate run budget and per-stage budgets; it reads child `message_end` usage to enforce. This feature provides the API surface the orchestrator needs.
- **Dogfooding playbook:** [Dogfooding — the agent-land playbook](/playbook/dogfooding.md) — lists "Know a session's cost / context fill" as a gap blocking dogfooding phases 1+. This feature closes the gap.

[^kill-switch-adr]: [Per-Run Kill-Switch with Incremental Token and Cost Tracking](/adrs/011-kill-switch.md)
[^dynamic-orchestration-design]: [Dynamic orchestration — multi-stage runs with adaptive budgets](/product/designs/dynamic-orchestration-design.md), §Interfaces 3 (soft budget enforcement via child usage accounting) and §Answers 4 (per-stage + aggregate budget semantics)
