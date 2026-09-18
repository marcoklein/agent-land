---
type: Design
title: Session stats — tokens, cost, context %
description: Expose pi's get_session_stats (tokens, cost, context-%) through al status CLI and GET /api/sessions/:id/stats JSON/SSE API. Operator observability for cost trends; orchestrator integration for soft-budget accounting.
status: draft
tags: [observability, cost, budget, cli, api, composition]
generated: { by: opencode/claude-opus, at: 2026-09-19T00:00:00Z }
sources:
  - id: feature
    resource: /product/features/session-stats.md
    title: Session stats Feature note
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: kill-switch
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: dynamic-orchestration
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration Design
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding playbook
  - id: boundaries
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
---

# Session stats — tokens, cost, context %

## Approach

This design exposes pi's `get_session_stats` RPC output unchanged through two composition-only surfaces — CLI and JSON API — with **no server-side cost calculation, no new engine primitives, and no budget-enforcement server code**[^engine][^boundaries]. The platform becomes a transparent proxy for pi's per-session economics, surfacing the data operators need to spot spend trends and enabling the orchestrator's soft-budget accounting loop to observe child consumption without mid-run enforcement (which remains ADR 011 future work)[^kill-switch].

The operator queries stats **post-hoc** via `al status <session-id>` or live via the JSON endpoint; the orchestrator **parses `message_end` usage events in real-time** for per-stage budget accounting, with the stats endpoint available as an optional operator-query surface, never required for orchestrator automation. This layering keeps cost transparency orthogonal to cost enforcement — the operator sees spend trends, the orchestrator sees per-child budget consumption, and the kill-switch (threshold-based termination) is a separate server-side feature (ADR 011).

## Interfaces

### 1. JSON API — `GET /api/sessions/:id/stats`

A new, read-only endpoint returning pi's `get_session_stats` output:

```json
{
  "tokens": {
    "input": 4250,
    "output": 1830,
    "total": 6080
  },
  "cost": {
    "input": 0.0085,
    "output": 0.0055,
    "total": 0.014
  },
  "context": {
    "percent": 23.5,
    "tokens_used": 756,
    "tokens_available": 3216
  },
  "updated_at": "2026-09-19T14:32:55Z"
}
```

**Contract details:**

- **Live and stopped sessions.** Works for both; stopped sessions retain their final `usage` payload from the last `message_end` event and remain queryable until session garbage collection (per the session retention policy, orthogonal to this design).
- **Source:** Pi's `get_session_stats` RPC call, called server-side and returned as-is. No transformation, rounding, or cost translation — delegation to the Provider and pi.
- **Frequency:** No polling required. The value represents the session's cumulative state at query time (live sessions) or final state (stopped sessions).
- **Permissions:** Currently single-operator model; any caller with basic auth can query any session's stats (identity is enforced by the `AGENT_LAND_BASIC_AUTH` envelope, not per-session).

**Implementation notes:**

- The server calls pi's `get_session_stats` RPC on each `GET /api/sessions/:id/stats` request (no server-side caching of stats; each call is live for running sessions).
- Session records already carry `usage` from the `message_end` event payload; the stats endpoint calls pi to re-derive the aggregate in a normalized shape.
- Error handling: if the session is not found, return 404; if pi's RPC call fails (e.g., pi crashed), return 503 or 500 with a message indicating the agent harness is unavailable.

### 2. CLI — `al status`

A new command for human query:

```bash
# Current session (from AGENT_LAND_SESSION_ID)
$ al status
Session: a5060d50
Status:   running
Tokens:   6,080 (4,250 input + 1,830 output)
Cost:     $0.014 (input: $0.0085 + output: $0.0055)
Context:  23.5% (756 / 3,216 tokens)
Updated:  2026-09-19T14:32:55Z

# Specific session
$ al status a5060d50
# (same output)

# Stopped session
$ al status b6171e61
Session: b6171e61
Status:   stopped
Tokens:   15,340
Cost:     $0.031
Context:  48.2%
Updated:  2026-09-19T12:01:23Z (final)
```

**Contract details:**

- **Default to current session:** if no session ID is provided, read `AGENT_LAND_SESSION_ID` env var and query that session. If the env var is not set, print an error: `error: no session ID provided and AGENT_LAND_SESSION_ID not set`.
- **Output format:** human-readable table, one row per stat. Tokens and cost are formatted with thousands separators (6,080 not 6080); cost is rendered as USD (`$0.014`); context % is rendered as a percentage (23.5%, not 0.235).
- **Table header:** session ID, status (running/stopped/waiting_for_input), then the stats.
- **Stopped indicator:** if the session is stopped, append ` (final)` to the `updated_at` timestamp to signal that stats will not change.

**Implementation notes:**

- The CLI command makes a `GET /api/sessions/:id/stats` call (reusing the JSON API).
- Format parsing: the CLI parses the JSON response and renders a human table.
- Timeout: set a reasonable HTTP timeout (e.g., 10s) for the query, with a message if the server is slow.

### 3. Orchestrator integration

The orchestrator consumes session stats for **soft-budget accounting** — it checks per-child spend after each `message_end` event and decides whether to continue, retry, or delete the child[^dynamic-orchestration]. Two paths:

**Path A (immediate):** The orchestrator **parses `message_end` events in real-time** from the child's event stream. Each `message_end` carries the cumulative `usage` payload (tokens, cost); the orchestrator aggregates these values against the per-stage and run budgets and takes action without querying the stats endpoint. This is the primary integration for Phase 4 dynamic orchestration.

**Path B (optional operator query):** The operator or an external system calls `GET /api/sessions/:id/stats` to observe a session's current spend without parsing the event log. This is read-only observation, not automation.

**Rationale:** Path A is real-time and efficient (event parsing is already happening); Path B adds operator convenience without requiring the orchestrator to use it. The stats endpoint is not a hard dependency for the orchestrator, only an optional surface for human queries.

## Answers to the Feature note's open questions

1. **Source of truth — pi's `get_session_stats` vs. event parsing.** **Decided:** Pi's `get_session_stats` RPC is the platform's source of truth for summary stats. The orchestrator can parse `message_end` events in real-time for per-stage budget enforcement (more efficient for automation), but the stats endpoint serves operator queries and provides a normalized, durable summary. No server-side event aggregation or snapshot history; each `GET /api/sessions/:id/stats` call is fresh.

2. **Scope — per-session vs. aggregate.** **Decided:** Per-session is the core feature. Aggregate stats (e.g., `al status --aggregate <run-id>` summing all child sessions in a run) is an orchestrator-side concern — the orchestrator holds the run budget and sums child spend itself. No server-side aggregate endpoint or `--aggregate` CLI flag in this design; the operator can sum per-session queries or rely on the orchestrator's run-trace notes.

3. **API endpoint shape — separate `/stats` vs. field in session response.** **Decided:** A separate `GET /api/sessions/:id/stats` endpoint. Rationale: (1) avoids payload bloat on `GET /api/sessions` list operations, (2) allows the stats endpoint to be called independently without fetching the entire session record, (3) keeps concerns clean — session metadata and session economics are orthogonal, (4) future permission scoping (e.g., read-only stats queries) is easier with a separate endpoint.

4. **Orchestrator consumption — polling vs. real-time event parsing.** **Decided:** Event parsing for orchestrator automation (real-time, efficient, no polling overhead); stats endpoint available for operator convenience and observability dashboards. The orchestrator reads `message_end` events from the child's event stream as they arrive, extracts the `usage` payload, and updates its spend tracking live. No polling loop required.

5. **Stopped session retention.** **Decided:** Session stats persist as part of the session record (via the `usage` field in the final `message_end` event). Stopped sessions remain queryable indefinitely per the session retention policy (orthogonal to this design — retention is an operational SLO, not a stats concern). If a session is garbage-collected, its stats are lost; the operator's durable record is the PR merge history and exported event logs, not the session object.

## Risks & mitigations

- **Live sessions' stats are eventually consistent.** Between `message_end` events, the stats endpoint may return stale values. Mitigation: this is acceptable for operator queries (the update lag is typically seconds); the orchestrator avoids this by parsing events real-time. If mid-turn budget alerts are needed, that is a separate feature (ADR 011 kill-switch).

- **Cost translation is provider-specific.** If pi's `cost` field is unavailable or the provider doesn't track cost, the stats endpoint returns `null` or a zero value. Mitigation: operators and orchestrators must tolerate missing cost data gracefully. Document this in the CLI output and API contract. The platform does not translate tokens → cost (that is a Provider responsibility, as per ADR 015).

- **Performance: stats endpoint polls pi's RPC on every call.** If pi is slow or down, the stats endpoint times out or errors. Mitigation: accept this; pi is in-process in the reference runtime (`pi --mode rpc` in the container), so latency is minimal. If it becomes a bottleneck, caching or event-driven stats updates can be added later.

- **Operator identity:** Currently any authenticated user can query any session's stats. Multi-user auth and per-session permissions are future work (orthogonal to this design, per the engine's single-operator model)[^engine].

- **Retention policy ambiguity.** The feature note defers the exact retention SLO (how long stopped sessions are kept). Mitigation: document the current behavior at session GC time and update this design once the policy is formalized.

## ADR pointers

No new ADR is required. This design is **pure composition** — it exposes an existing RPC surface (pi's `get_session_stats`) through two new client interfaces (CLI and API endpoint) with no engine changes[^boundaries].

**Related decisions:**

- **ADR 011 — Per-Run Kill-Switch.** This design provides the observational foundation (stats are readable); hard enforcement (server-side kill-switch) remains ADR 011 future work.
- **ADR 015 — Providers as Config Records.** Cost values come directly from pi's `usage.cost` field (a provider responsibility); no server-side vendor-specific translation.
- **ADR 017 — Product Layer on OKF Memory.** The stats endpoint and CLI are composition, not engine primitives.
- **Dynamic Orchestration Design.** Orchestrator soft-budget enforcement reads `message_end` usage events; the stats endpoint is an optional auxiliary surface.

## Minimal change set

### Server changes (`packages/server`)

1. **New route: `GET /api/sessions/:id/stats`** — calls pi's `get_session_stats` RPC and returns the normalized response. Add to `packages/contracts/src/routes.ts` and implement in the session service.

### CLI changes (`packages/cli`)

2. **New command: `al status [session-id]`** — calls the stats endpoint and renders a human table. Defaults to `AGENT_LAND_SESSION_ID` if no ID is provided.

### Tests

3. **Server tests** — test the stats endpoint for live and stopped sessions, error cases (session not found, pi RPC failure).
4. **CLI tests** — test `al status` with and without session ID, environment variable fallback, table formatting.

### Documentation

5. **Update `docs/knowledge/platform/cli.md`** — document the new `al status` command.
6. **Update `packages/contracts/src/routes.ts` (inline comments or jsdoc)** — document the stats endpoint contract.

**What is NOT changed:**

- No engine primitives added (Session, Mount, Connector, Provider, Event Stream, Platform Connector remain unchanged).
- No server-side cost calculation, budget thresholding, or kill-switch logic — that is ADR 011 future work.
- No new database or event aggregation layer.
- No web UI changes (per ADR 016, presentation is a separate consumer).
- No orchestrator recipe changes in this PR (dynamic orchestration's integration is already designed to parse events; the stats endpoint is an auxiliary surface the orchestrator *can* call but doesn't require).

## Implementation notes for the engineering hand-off

1. **Session lifecycle:** Confirm that stopped sessions retain their `usage` field (from the final `message_end` event) and remain queryable. Test with a stopped session to verify `GET /api/sessions/:id/stats` works.

2. **Pi RPC contract:** Verify the exact shape of pi's `get_session_stats` response and handle any version skew gracefully (e.g., older pi versions that don't include `context_percent`).

3. **Cost precision:** Confirm pi's `cost` field precision (e.g., cents vs. milli-cents) and preserve it as-is in the API response (no rounding by the server).

4. **Error cases:**
   - Session not found → 404 with a message.
   - Pi RPC call fails (pi crashed, timeout) → 503 with "Agent harness unavailable".
   - `AGENT_LAND_SESSION_ID` not set when running `al status` (no ID provided) → error message asking for a session ID.

5. **Testing:** Test the full path — create a session, run it to completion, call `GET /api/sessions/:id/stats` live and after stopping, verify the values match pi's output.

[^engine]: [Agent Land engine](/platform/engine.md) — six primitives, everything else is composition.
[^boundaries]: [Agent Land domain boundary](/product/goals/boundaries.md) — cost transparency is composition, not an in-core engine feature.
[^kill-switch]: [Per-Run Kill-Switch ADR](/adrs/011-kill-switch.md) — hard enforcement is future work; this design is observational only.
[^dynamic-orchestration]: [Dynamic Orchestration Design](/product/designs/dynamic-orchestration-design.md) — §Answers 4 (Budgets) explains orchestrator soft-budget enforcement via `message_end` usage parsing.
