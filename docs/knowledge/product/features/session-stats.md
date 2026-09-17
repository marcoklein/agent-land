---
type: Feature
title: Session stats — expose cost and context usage
description: Expose pi's get_session_stats RPC (cumulative tokens, cost, context-fill %) through al status CLI and the JSON/SSE API so operators can observe spend and context pressure.
status: draft
tags: [observability, budget, kill-switch, orchestration]
generated: { by: pi/qwen3.8-max, at: 2026-09-17T00:00:00Z }
sources:
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding playbook — gaps and phases
    usage_count: 1
  - id: kill-switch
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
    usage_count: 1
  - id: dynamic-orch
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration design — soft budget enforcement
    usage_count: 1
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
    usage_count: 1
  - id: session-contract
    resource: packages/contracts/src/session.ts
    title: Session contract (zod schemas)
    usage_count: 1
  - id: issue
    resource: https://github.com/marcoklein/agent-land/issues/97
    title: Issue #97 — Expose session cost & context stats via al status
---

# Session stats — expose cost and context usage

Operators need visibility into cumulative session spend and context fill to understand cost control, predict budget overruns, and enable the dynamic orchestrator (Phase 4) to enforce soft per-stage and aggregate run budgets[^kill-switch][^dynamic-orch].

pi's `get_session_stats` RPC already emits this data (tokens, cost, context-fill %) — this feature is pure **surface exposure**, not new calculation or heuristics. Stats come from `message_end` events, not server-side approximation.

## Why

The [dogfooding playbook](/playbook/dogfooding.md) marks "Know a session's cost / context fill" as a **high-impact blocker** for Phase 4 (dynamic orchestration) and later phases. Today:

- Operators cannot query session spend without accessing logs or internal session state — spend is invisible.
- The orchestrator (Phase 4) will enforce soft per-stage budgets by reading `message_end` usage, but has nowhere to make stats queryable for budget-driven decisions.
- Cost control and context pressure are unmeasurable — no way to predict overruns or tune models/prompts.

The dynamic orchestration design shows how the orchestrator will use stats: parse `message_end` usage, accumulate per-stage, compare against soft limits, and `DELETE` over-budget children (§Interfaces 4)[^dynamic-orch]. Without stats exposure, the orchestrator cannot audit final spend or a human cannot review cost after a run.

This is a **composition change, not an engine change** — pi already computes stats; the platform just needs to surface them through the CLI and API.

## User stories

- As an operator, I want to run `al status <session-id>` and see cumulative token usage, cost, and context-fill %, so I can understand session spend and predict budget pressure before overruns happen.
- As an operator, I want the same stats visible in `GET /api/sessions/:id`, so monitoring tools and dashboards can track spend across live sessions.
- As an orchestrator agent, I want to query child-session stats after they settle, so I can account actual spend against the aggregate run budget and audit the final cost.
- As an operator, I want stats for both live sessions (real-time from the event stream) and stopped sessions (persisted final values), so no data is lost when a session ends.

## Acceptance criteria

- `al status <session-id>` prints the session record plus three new lines: tokens (cumulative), cost (cumulative), and context-fill percentage.
- `al status` with no arguments prints stats for the current/active session (existing behavior extended).
- Stats are sourced from pi's `get_session_stats` RPC (emitted in `message_end` events), not heuristic calculation.
- The Session contract (`packages/contracts/src/session.ts`) extends to include `tokens: number`, `cost: number`, `contextFillPercent: number`.
- `GET /api/sessions/:id` returns the same three stats in the response body (top-level fields, not nested).
- Stats accumulate over the session's lifetime and persist when the session stops.
- The implementation works for both live sessions (parsing `message_end` in real time) and stopped sessions (reading persisted record).
- No changes to the engine or the six primitives — this is a composition concern only[^engine].

## Open questions

**Q1: Stat accumulation — real-time vs. on-demand?**
Should the server parse `message_end` events and accumulate stats in real time (live sessions always show current totals), or compute them on-demand when queried? *Recommended:* real-time accumulation in `SessionHandle` with atomic persistence to `SessionRepository` on each `message_end`, so live sessions show usage mid-turn and operators can watch cost grow. On-demand is cheaper but adds latency and makes real-time monitoring harder.

**Q2: Context-fill % calculation.**
Is context-fill % a value pi emits directly in `get_session_stats`, or should the server compute it from token count + model context window? *Recommended:* if pi emits it, use it unchanged. If not, compute as `(tokens used) / (model context window)` on the server side as a best-effort estimate — look up the model's context length from the provider config, and document that this is an approximation (real limits depend on role-based context, system prompts, and pi's tokenizer).

**Q3: API shape — nested vs. top-level stats.**
Should `GET /api/sessions/:id` return `{ stats: { tokens, cost, contextFillPercent } }` (nested) or promote the three fields to top level (`{ id, status, tokens, cost, contextFillPercent, … }`)?
*Recommended:* top-level fields. Simpler for the CLI, aligns with the Session contract, and reduces nesting for dashboards.

**Q4: CLI presentation — single line or multi-line, with warnings?**
Should `al status` print a compact summary ("tokens: 45k, cost: $0.45, context: 67%") or a formatted multi-line display with human-readable ranges? Should it warn if context fill exceeds a threshold? *Recommended:* multi-line, human-readable format (e.g., "Context fill: 67% (45,234/65,536 tokens)"); warnings as a separate optional concern (flag `al status --warn-threshold 80`), not in scope for this issue.

**Q5: Tree stats — aggregate over orchestrator + children?**
Should `al status <session-id>` show total cumulative spend for an orchestrator run plus all its children? *Recommended:* out of scope. Tree stats will be computed by the orchestrator for aggregate-run-budget enforcement during Phase 4. Single-session stats are sufficient for this feature; tree views are polish.

**Q6: Kill switch vs. stats exposure.**
ADR 011 specifies per-run kill switches (timeout, maxTokens, maxCost) enforced by pi's `message_end` events. Should this feature also add server-side hard kill-switches that terminate a session on budget overrun? *Recommended:* no, out of scope. This feature is observation only; ADR 011's per-run kill switches are pi's responsibility (enforced at the engine level). The orchestrator will read stats and enforce soft orchestrator-side budgets (Phase 4); no hard server-side enforcement here.

## Dependencies & cross-links

- **Dogfooding gap:** [/playbook/dogfooding.md](/playbook/dogfooding.md) — §"What works today vs the gaps" (high-impact blocker for Phase 4).
- **Kill switch design:** [/adrs/011-kill-switch.md](/adrs/011-kill-switch.md) — per-run limits, `message_end` usage parsing, the source of stats.
- **Dynamic orchestration:** [/product/designs/dynamic-orchestration-design.md](/product/designs/dynamic-orchestration-design.md) — §Interfaces 4, §Answers 4: how the orchestrator will enforce soft budgets by reading stats.
- **Multi-agent roadmap:** [/playbook/multi-agent-workflow.md](/playbook/multi-agent-workflow.md) — Phase 4 (dynamic orchestration) explicitly depends on observable spend.
- **Engine primitives:** [/platform/engine.md](/platform/engine.md) — this feature composes from Session (primitive 4) and Event Stream (primitive 5), no new primitives.

## Design handoff

The design stage must:
1. Extend the `Session` zod schema with three required fields: `tokens`, `cost`, `contextFillPercent`.
2. Specify how `SessionHandle` parses `message_end` events to accumulate stats.
3. Define persistence: when and how stats are written to `SessionRepository`.
4. Extend `GET /api/sessions/:id` response to include the three stats fields.
5. Update `al status` formatting and `statusJson` output.
6. Answer open questions Q1 and Q2 with concrete implementation choices.
7. Document the context-fill % calculation (if server-side) or link to pi's behavior (if pi-emitted).

[^kill-switch]: [Per-Run Kill-Switch ADR](/adrs/011-kill-switch.md) — incremental token/cost tracking via `message_end`, the source of stats.
[^dynamic-orch]: [Dynamic Orchestration design](/product/designs/dynamic-orchestration-design.md) — orchestrator-side soft budget enforcement (§Interfaces 4) by reading child stats.
[^engine]: [Agent Land engine](/platform/engine.md) — six primitives, composition above. Stats exposure is composition: no engine change.
