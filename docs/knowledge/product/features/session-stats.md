---
type: Feature
title: Session stats — tokens, cost, context fill
description: Expose pi's get_session_stats through al status and the JSON/SSE API so operators see spend and context pressure, prerequisite for budget guardrails.
status: draft
generated: { by: opencode/pi, at: 2025-01-15T00:00:00Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the six primitives
  - id: kill-switch-adr
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: dynamic-orchestration-design
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration design — budget accounting
  - id: cli-observability-design
    resource: /product/designs/cli-observability-design.md
    title: CLI session observability design
  - id: issue
    resource: https://github.com/marcoklein/agent-land/issues/97
    title: GitHub Issue #97 — session stats for al status
---

# Session stats — tokens, cost, context fill

## Why

pi's `get_session_stats` RPC exposes cumulative tokens consumed, cost accrued, and context-fill percentage — critical signals for agent-land operators to understand spend and context pressure. Today, this data is never accessed or displayed. As a result:

1. **Operators are blind to spend** — they cannot see token usage or accrued cost for a running or completed session, making it impossible to debug expensive runs or anticipate budget overruns.
2. **Budget guardrails have no visibility surface** — the per-run kill switch (ADR 011) needs a CLI and API surface to display the cumulative stats it enforces; without it, the kill switch is invisible to users.
3. **The dynamic orchestrator cannot enforce aggregate budgets** — the orchestrator must watch child sessions' `message_end` usage events and sum them against per-stage and aggregate run budgets; without exposing that data through the API, the orchestrator cannot be debugged or trusted by operators.

This feature bridges that gap by surfacing session stats through `al status` (the CLI observability command) and through `GET /api/sessions/:id` (the JSON/SSE API), so operators can monitor spend, context pressure, and budget consumption — and the kill switch and orchestrator can read and enforce limits.

## User stories

- **As an operator**, I want to run `al status <session-id>` and see token usage, cost, and context-fill percentage, so I can understand what the session spent and whether it's approaching my context limit.

- **As an operator**, I want to run `al status` (no session-id, for the current session) and see the same stats, so I can check spend without having to name the session ID.

- **As an agent developer** (orchestrator, kill switch), I want to call `GET /api/sessions/:id` (or a dedicated stats endpoint) and receive `{ tokens, cost, contextFill }` in the JSON response, so I can account spend against per-stage and aggregate run budgets and enforce limits.

- **As an operator**, I want to script `al status --json` to extract stats programmatically, so I can integrate session spend into dashboards or billing systems.

## Acceptance criteria

- `al status <session-id>` prints token usage, cost accrued (in $), and context-fill percentage (0–100).
- `al status` (without session-id) works for the current session.
- Both commands work for live (running) sessions and stopped sessions.
- Stats are sourced from pi's `get_session_stats` RPC, not heuristically calculated from the event log.
- The JSON/SSE API exposes the same stats on `GET /api/sessions/:id` (or a dedicated endpoint), so agents can read them programmatically.
- `al status --json` emits a single JSON object containing the session record and stats.
- Human-readable output shows stats as compact lines (e.g., `tokens: 45230`, `cost: $0.32`, `context: 42%`).

## Open questions for the design note

1. **`get_session_stats` contract.** What does pi's `get_session_stats` RPC return? Is it cumulative tokens/cost/context% in a single call, or does usage stream into `message_end` events and `get_session_stats` is just a snapshot? Does pi emit usage in every `message_end`, or only when there's new usage?

2. **Platform stats accumulation strategy.** Should the platform accumulate stats as it parses `message_end` events (streaming accumulation), or call `get_session_stats` on demand when a client requests stats (lazy fetching)? If streaming, where does accumulation happen (harness, session service, in-memory state)? If lazy, what latency is acceptable for live sessions?

3. **API shape — extend Session or dedicated endpoint.** Should `GET /api/sessions/:id` extend the `Session` response to include optional `usage: { tokens, cost, contextFill }` fields, or create a dedicated `GET /api/sessions/:id/stats` endpoint? Extending the session is simpler; a separate endpoint is more explicit.

4. **Real-time vs. last-known for live sessions.** When `al status` runs against a live session, should it block for a fresh `get_session_stats` call (guaranteed fresh), or display the last-observed stats from the event stream (faster, possibly stale)? For stopped sessions, stats are final.

5. **CLI command shape.** Should `al status` (already designed in cli-observability-design.md) be extended to include stats, or should there be a separate `al stats <session-id>` command? The existing design sketches stats integration into `al status`; clarify whether stats appear in the human output or only via `--json`.

6. **Accuracy for multi-turn sessions.** If a session runs multiple turns, does `get_session_stats` return cumulative totals across all turns, or per-turn? The orchestrator needs cumulative totals to account aggregate spend; clarify that stats are always cumulative.

7. **Context-fill calculation.** What is the denominator for context-fill percentage? The model's max context window (from the model definition)? Tokens used / max context, clamped to [0, 100]? Or a running average across turns?

## Cross-links

This feature directly extends [Agent Land's observation model](/platform/engine.md#observation) — Event Stream is the primary observation channel, and session stats are metadata the engine projects from pi's RPC interface. It is prerequisite for:

- **ADR 011** ([Per-Run Kill-Switch](/adrs/011-kill-switch.md)) — the kill switch enforces per-run `maxTokens` and `maxCost` limits by parsing `message_end` usage; this feature surfaces that enforcement so operators can see what was enforced.
- **Dynamic Orchestration design** ([§Interfaces 3, §Answers 4](/product/designs/dynamic-orchestration-design.md)) — the orchestrator watches each child's `message_end` usage to account spend against per-stage and aggregate run budgets; this feature exposes the cumulative stats the orchestrator sums.
- **CLI observability design** ([`al status` command](/product/designs/cli-observability-design.md)) — this feature extends `al status` to include stats alongside the session record and last message.

The feature composes purely from the six engine primitives: Session (the agent process), Event Stream (observation of `message_end` usage), and an optional query to pi's RPC interface. No new primitives are added.
