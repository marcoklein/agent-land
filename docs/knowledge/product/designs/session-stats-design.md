---
type: Design
title: Session cost and context stats via `al status` — stats columns
description: Extend `al status` to show token usage, cost, and context-fill % by parsing session events (no server change). Integrates with orchestrator budget enforcement and operator observability.
status: draft
tags: [cli, observability, budget, kill-switch, orchestration]
generated: { by: opencode/claude-3.5-sonnet, at: 2026-09-16T00:00:00Z }
sources:
  - id: feature
    resource: /product/features/session-stats.md
    title: Expose session cost and context stats via `al status`
  - id: cli-observability-design
    resource: /product/designs/cli-observability-design.md
    title: CLI session observability design (al log --json, al status)
  - id: kill-switch-adr
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: dynamic-orchestration-design
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic orchestration — multi-stage runs with adaptive budgets
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: cli
    resource: /platform/cli.md
    title: CLI (`al`) reference
  - id: adr-014
    resource: /adrs/014-json-api-canonical-machine-interface.md
    title: JSON API is the canonical machine interface
  - id: session-contract
    resource: packages/contracts/src/session.ts
    title: Session record schema
  - id: event-contract
    resource: packages/contracts/src/event.ts
    title: Session event schema and message types
---

# Session cost and context stats via `al status` — design

## Approach

**No server change.** Extend `al status` to parse the session event stream (same replay pattern as `cli-observability-design`) and extract cumulative token usage and cost from `message_end` events[^kill-switch-adr]. Context-fill % is computed as `tokensUsed / contextLimit` from the first available `message_end` event (pi's `get_session_stats` carries this). The implementation mirrors the existing `lastAssistantText` reducer in `cli-observability-design.md`: iterate once through the SSE stream, accumulate usage fields, and format them alongside the existing status/mounts/connectors/last-message output.

**Rationale:** The orchestrator will read stats via the same JSON/SSE API (§Interfaces below), so the stats must be queryable at any time (running or stopped). Deriving stats client-side from the event stream (already replayed for last-message extraction) is the **minimal path** that avoids:
- Adding a new server RPC call or cache (which would add latency and synchronization complexity);
- Storing stats in the `Session` record schema (which conflates fixed create-time fields with runtime observables);
- Polling pi's `get_session_stats` repeatedly (which is expensive and races with live turns).

The event stream is the single source of truth (per `engine.md`); stats are a projection of that stream, computed on demand. Running sessions show stats **for all completed turns** (the event stream at the moment `al status` runs); stopped sessions show final stats.

## Interfaces

### CLI surface (extends cli-observability-design)

`al status <session-id>` now prints stats lines after the last-message block (unchanged from cli-observability-design, except for the addition):

**Human-readable output:**

```
<id>  <status>
mounts: <source>:<target>, … | (none)
connectors: <name>, … | (none)
model: [<provider>/]<model>
created: <createdAt>
updated: <updatedAt>
last message: <text> | (none)
tokens: <n>
cost: $<decimal>
context fill: <percent>%
waiting for: <method>[ — <prompt>]        # only when waitingFor is present
```

**JSON shape (`al status --json`):**

```json
{
  "session": { … },
  "lastMessage": "<text>",
  "stats": {
    "tokens": <number>,
    "inputTokens": <number>,
    "outputTokens": <number>,
    "cost": <number>,
    "contextFill": <number>
  }
}
```

Semantics:
- `tokens` — total input + output tokens seen so far.
- `inputTokens`, `outputTokens` — cumulative per category.
- `cost` — cumulative cost in USD (decimal, e.g., `0.00123`).
- `contextFill` — percentage (0–100); missing if context limit is unknown. Computed as `tokensUsed / contextLimit * 100`.

**Live session behavior:** Stats reflect all *completed turns*. A turn is "completed" when its `message_end` event has been parsed. If the session is mid-turn (streaming `message_delta` deltas, no `message_end` yet), stats do not include in-flight deltas — only finalized turns. This matches the "turn is settled when its output arrives" semantics from the engine[^engine].

**Stopped session behavior:** Stats are final and stable; they reflect the full event history up to `agent_settled` or `agent_done`.

### `packages/cli/src/lib/status.ts` (extend with stats)

Extend the existing `status.ts` from cli-observability-design:

```ts
export interface SessionStats {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  contextFill?: number;  // percentage 0–100; optional if context limit unknown
}

/** Pure reducer: accumulate usage from message_end events. */
export function accumulateStats(events: Iterable<AgentEvent>): SessionStats {
  let tokens = 0, inputTokens = 0, outputTokens = 0, cost = 0, contextFill: number | undefined;
  
  for (const ev of events) {
    if (ev.type === "message_end" && ev.usage) {
      const u = ev.usage;
      // Cumulative fields
      if (u.inputTokens !== undefined) inputTokens += u.inputTokens;
      if (u.outputTokens !== undefined) outputTokens += u.outputTokens;
      if (u.totalTokens !== undefined) tokens += u.totalTokens;
      if (u.cost !== undefined) cost += u.cost;
      
      // Context fill (snapshot from first available event)
      if (contextFill === undefined && u.contextFill !== undefined) {
        contextFill = u.contextFill;
      }
    }
  }
  
  return { tokens, inputTokens, outputTokens, cost, contextFill };
}

/** Extend SessionStatusResult to include stats. */
export interface SessionStatusResult {
  session: Session;
  lastMessage: string;
  stats: SessionStats;
}

/** Extend getSessionStatus to compute stats from event stream. */
export async function getSessionStatus(
  client: StatusClient,
  sessionId: string,
  { stream = streamSse }: { stream?: StreamFn } = {}
): Promise<SessionStatusResult> {
  // Existing: fetch session record, replay event stream once.
  const { session } = await client.getSession(sessionId);
  const dedupe = createSeqFilter();
  const events: AgentEvent[] = [];
  // … replay loop (unchanged from cli-observability-design) …
  
  const lastMessage = lastAssistantText(events);
  const stats = accumulateStats(events);
  
  return { session, lastMessage, stats };
}

/** Extend formatStatus to include stats lines. */
export function formatStatus(result: SessionStatusResult): string[] {
  const lines = [
    `${result.session.id}  ${result.session.status}`,
    `mounts: ${result.session.mounts.map(m => \`\${m.source}:\${m.target}\`).join(", ") || "(none)"}`,
    `connectors: ${result.session.connectors.map(c => c.name).join(", ") || "(none)"}`,
    `model: ${result.session.model}`,
    `created: ${result.session.createdAt}`,
    `updated: ${result.session.updatedAt}`,
    `last message: ${result.lastMessage || "(none)"}`,
    `tokens: ${result.stats.tokens}`,
    `cost: $${result.stats.cost.toFixed(6)}`,
  ];
  
  if (result.stats.contextFill !== undefined) {
    lines.push(`context fill: ${result.stats.contextFill.toFixed(1)}%`);
  }
  
  if (result.session.waitingFor) {
    lines.push(`waiting for: ${result.session.waitingFor.method}${result.session.waitingFor.prompt ? \` — \${result.session.waitingFor.prompt}\` : ""}`);
  }
  
  return lines;
}

/** Extend statusJson to include stats object. */
export function statusJson(result: SessionStatusResult): string {
  return JSON.stringify(
    { session: result.session, lastMessage: result.lastMessage, stats: result.stats },
    null,
    2
  ) + "\n";
}
```

### Event stream contract (no change)

The `message_end` event already carries a `usage` field per ADR-011[^kill-switch-adr]:

```ts
// packages/contracts/src/event.ts
export interface MessageEndEvent {
  type: "message_end";
  message: Message;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cost?: number;
    contextFill?: number;  // 0–100 percentage
  };
}
```

No server changes needed; this contract already exists (kill-switch ADR populates it when pi returns usage data).

### Orchestrator integration point (deferred to orchestrator design)

The orchestrator reads each child's stats via:

1. **Option A (event-stream polling):** The orchestrator watches each child's event stream (existing pattern in dynamic-orchestration-design) and accumulates `message_end.usage` the same way `accumulateStats` does. The child's stats are observable in real time as events arrive.

2. **Option B (API endpoint):** A future `GET /api/sessions/:id/stats` endpoint returns `{ tokens, inputTokens, outputTokens, cost, contextFill }` computed the same way. This would be a convenience layer; the orchestrator still polls (e.g., after each child settle) rather than subscribing.

**Decision:** Defer to orchestrator design stage. For now, `al status --json` exposes stats via the JSON API (embedded in the full `SessionStatusResult`), and the orchestrator can read the same event stream the CLI uses. If polling turns out to be the bottleneck, a dedicated `/api/sessions/:id/stats` endpoint is a clean future extension (no breaking changes, since the event stream pattern works today).

### Tests (vitest, `pnpm --filter @agent-land/cli test`)

Extend `packages/cli/src/lib/status.test.ts`:

- **`accumulateStats`:**
  - No `message_end` events → all zeros, no `contextFill`.
  - One `message_end` with `usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.001 }` → `{ tokens: 30, inputTokens: 10, outputTokens: 20, cost: 0.001 }`.
  - Two `message_end` events → cumulative sum.
  - `contextFill` from first event is captured; later events' `contextFill` is ignored (snapshot semantics).
  - Missing fields (e.g., no `cost` in an event) are safe (skipped, no crash).
  
- **`formatStatus`:**
  - `tokens: <n>` line present.
  - `cost: $<decimal>` formatted to 6 decimal places.
  - `context fill: <percent>%` only present if `contextFill !== undefined`.
  - Cost of `0` renders as `$0.000000`.
  
- **`statusJson`:**
  - `stats` object is included in the JSON.
  - `stats` has all five fields (or four + optional `contextFill`).

## Risks & mitigations

**Risk: Stats lag for running sessions.** Like `al status` for last-message extraction, the replay relies on the 500 ms quiet-stop heuristic. A busy session streaming deltas keeps the connection open. *Mitigation:* this is the existing trade-off from `cli-observability-design`; stats inherit the same bounds. For running sessions, operators see stats for all *completed* turns, which is typically 1–2 seconds behind the latest turn start. A future server snapshot endpoint (deferred) would eliminate the heuristic.

**Risk: `message_end.usage` fields are inconsistent or missing.** pi may not populate all fields for all providers. *Mitigation:* treat missing fields as zero or unknown (no crash). `contextFill` is marked optional; `tokens` and `cost` can safely default to 0 if absent.

**Risk: Context-fill snapshotting.** `contextFill` is taken from the first `message_end` event and never updated. If context limit changes mid-run, the displayed % is stale. *Mitigation:* context limits are typically set at session create time (per the engine); they do not change mid-run in practice. If they do, the % becomes stale — accept this as a limitation and document it in `docs/knowledge/platform/cli.md`. A future "latest context snapshot" field would fix it; deferred.

**Risk: Cost accumulation assumes linear accumulation.** Some providers may refund cost (e.g., cached input) after the first turn, so cumulative sum might not be accurate. *Mitigation:* this is a limitation of deriving cost from `message_end` events; the accurate source is pi's `get_session_stats` RPC (which the orchestrator may eventually call for reconciliation). Document in the CLI docs that `cost` is approximate and may differ from pi's final statement. For now, it is the best available signal for operator observability.

## Answers to the Feature note's open questions

1. **Stats data surface:** Expose `inputTokens`, `outputTokens`, `totalTokens`, `cost`, and `contextFill` from `message_end.usage`. Per-turn breakdown is not displayed in human mode (only cumulative); the event stream is available via `al log --json` for detailed analysis.

2. **Live vs. stopped semantics:** 
   - **Running session:** Stats show all completed turns (events up to the quiet-stop replay's end).
   - **Stopped session:** Stats show all turns up to `agent_done` / `agent_settled` (final).
   - **Waiting for input:** Same as running (stats for turns up to the wait point).
   - Mid-turn deltas are not included in stats until their `message_end` event arrives.

3. **Implementation path:** **Option A (no server change).** Client-side event-stream parsing, reusing the existing `cli-observability-design` replay pattern. Minimal, testable, and pairs neatly with the orchestrator's need to read the same event stream. If polling becomes a bottleneck, Option B (dedicated endpoint) is a clean future extension.

4. **API surface:** Stats are embedded in `al status --json` as a `stats` sub-object on the `SessionStatusResult` (alongside `session` and `lastMessage`). No new API route yet; the orchestrator reads the event stream directly (existing pattern). If polling latency becomes an issue, a `GET /api/sessions/:id/stats` endpoint can be added later without breaking changes.

5. **CLI integration:** Stats lines are added to `al status` human output (one line per stat). `al status --json` includes the `stats` object. `al log --json` is unchanged (operator can reconstruct stats from `message_end` events if needed for detailed analysis).

6. **Orchestrator integration:** The orchestrator reads each child's stats by subscribing to the child's event stream and accumulating `message_end.usage` the same way `accumulateStats` does. If polling becomes necessary, the `/api/sessions/:id/stats` endpoint is a future extension (design stage deferred).

## ADR pointers

**ADR-011 (kill-switch):** This design operationalizes the `message_end.usage` contract defined in ADR-011. No new ADR needed; the decision is architectural (client-side parsing vs. server endpoint), which is already addressed by referencing the existing `engine.md` observation model.

**ADR-014 (JSON API is canonical):** The `al status --json` shape (including `stats` sub-object) is part of the stable machine-interface contract. The JSON must be versioned and backward-compatible if the schema evolves[^adr-014].

## Minimal change set

- **`packages/cli/src/lib/status.ts`** — extend:
  - Add `SessionStats` interface.
  - Add `accumulateStats(events)` pure reducer.
  - Update `SessionStatusResult` to include `stats: SessionStats`.
  - Update `getSessionStatus` to call `accumulateStats(events)` and include stats in result.
  - Update `formatStatus` to render stats lines.
  - Update `statusJson` to include stats object.

- **`packages/cli/src/lib/status.test.ts`** — extend:
  - Add `accumulateStats` test suite (as listed in Interfaces above).
  - Update `formatStatus` tests to verify stats lines.
  - Update `statusJson` tests to verify stats object.

- **`docs/knowledge/platform/cli.md`** — extend:
  - Document `al status` output now includes `tokens:`, `cost:`, `context fill:` lines.
  - Document `al status --json` includes `stats` sub-object.
  - Clarify that stats are cumulative and final for stopped sessions, and reflect completed turns for running sessions.
  - Note the ~500 ms latency / quiet-stop trade-off for running sessions.
  - Clarify that `cost` is approximate (derived from per-turn `message_end.usage`, not pi's final bill).

**Not touched:**
- Server (no new routes).
- Contracts (session.ts, event.ts already carry the necessary fields).
- Orchestrator (integration deferred to orchestrator design stage).
- `al log` (unchanged; stats are available in `message_end.usage` fields for detailed analysis).

## Implementation order

1. Extend `status.ts` with `SessionStats`, `accumulateStats`, and updated `getSessionStatus/formatStatus/statusJson`.
2. Write `status.test.ts` test cases for stats accumulation and rendering.
3. Update `docs/knowledge/platform/cli.md` with new output documentation.
4. Manual test: `al status <running-session-id>` and `al status --json <running-session-id>` to verify stats render correctly.

## Cross-links

- **Feature:** [Expose session cost and context stats via `al status`](/product/features/session-stats.md) — this design answers all open questions and is the implementation spec.
- **Existing design:** [CLI session observability design](/product/designs/cli-observability-design.md) — this design extends it with stats columns and reuses the replay pattern.
- **Kill-switch ADR:** [Per-Run Kill-Switch with Incremental Token and Cost Tracking](/adrs/011-kill-switch.md) — defines the `message_end.usage` contract that stats rely on.
- **Orchestrator design:** [Dynamic orchestration — multi-stage runs with adaptive budgets](/product/designs/dynamic-orchestration-design.md) — the orchestrator will read stats via the event stream (or a future API endpoint) to enforce budget constraints.
- **Engine:** [Agent Land engine — the purest form](/platform/engine.md) — event stream is the single observation channel; stats are a client-side projection.

[^feature]: [Expose session cost and context stats via `al status`](/product/features/session-stats.md)
[^cli-observability-design]: [CLI session observability design](/product/designs/cli-observability-design.md)
[^kill-switch-adr]: [Per-Run Kill-Switch with Incremental Token and Cost Tracking](/adrs/011-kill-switch.md)
[^dynamic-orchestration-design]: [Dynamic orchestration — multi-stage runs with adaptive budgets](/product/designs/dynamic-orchestration-design.md)
[^engine]: [Agent Land engine — the purest form](/platform/engine.md)
[^cli]: [CLI (`al`)](/platform/cli.md)
[^adr-014]: [ADR-014 — JSON API is the canonical machine interface](/adrs/014-json-api-canonical-machine-interface.md)
[^session-contract]: `packages/contracts/src/session.ts`
[^event-contract]: `packages/contracts/src/event.ts`
