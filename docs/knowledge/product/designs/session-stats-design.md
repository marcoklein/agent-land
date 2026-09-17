---
type: Design
title: Session stats — expose cost and context usage
description: Extend the Session contract with cumulative tokens, cost, and context-fill % fields; parse message_end events to accumulate stats in SessionHandle; persist to SessionRepository on each state transition; expose via GET /api/sessions/:id and al status CLI.
status: draft
tags: [observability, budget, kill-switch, orchestration, composition]
generated: { by: pi/qwen3.8-max, at: 2026-09-17T00:00:00Z }
sources:
  - id: feature
    resource: /product/features/session-stats.md
    title: Feature note — session stats exposure
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding playbook — gaps and phases
  - id: kill-switch
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: dynamic-orch
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration design — soft budget enforcement
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: session-contract
    resource: packages/contracts/src/session.ts
    title: Session contract (zod schemas)
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: SessionService implementation
  - id: status-cli
    resource: packages/cli/src/lib/status.ts
    title: Current al status implementation
  - id: api-sessions
    resource: packages/server/src/presentation/http/api-sessions.ts
    title: HTTP API sessions routes
---

# Session stats — expose cost and context usage

## Approach

This is a **pure surface exposure** of existing data — pi's `get_session_stats` RPC already emits tokens, cost, and context-fill % in `message_end` events. The platform simply needs to:

1. **Extend the contract:** Add three required fields to the `Session` zod schema: `tokens: number`, `cost: number`, `contextFillPercent: number`.
2. **Accumulate in memory:** The `SessionHandle` (in `session-service.ts`) parses each `message_end` event, extracts `usage` (if present), and increments cumulative counters.
3. **Persist atomically:** On each state transition (especially `agent_settled` and session stop), write the cumulative stats to `SessionRepository` as part of the session record.
4. **Expose uniformly:** Both `GET /api/sessions/:id` and `al status` automatically include the three stats once they are on the contract.

**No engine changes, no new heuristics, no server-side kill-switches.** The orchestrator (Phase 4) will read these stats from child sessions' final records and enforce soft budgets on its side[^dynamic-orch].

### 1. Contract extension (Session zod schema)

In `packages/contracts/src/session.ts`, add three fields to `sessionSchema`:

```typescript
export const sessionSchema = z.object({
  id: z.string(),
  status: sessionStatusSchema,
  // ... existing fields ...
  tokens: z.number().int().min(0).describe("Cumulative tokens used in this session."),
  cost: z.number().min(0).describe("Cumulative cost (in USD) for this session."),
  contextFillPercent: z.number().min(0).max(100).describe("Context fill percentage (0-100)."),
})
```

All three are required fields on the wire; all sessions (live and stopped) carry stats. Initial values: `0`, `0.0`, `0` respectively.

### 2. Stats accumulation in SessionHandle

In `packages/server/src/core/session-service.ts`, extend `SessionHandle` to hold cumulative counters:

```typescript
interface SessionHandle {
  // ... existing fields ...
  stats: {
    tokens: number;
    cost: number;
    contextFillPercent: number;
  };
}
```

Initialize to `{ tokens: 0, cost: 0, contextFillPercent: 0 }` on session creation.

In the `onEvent` handler, after receiving a `message_end` event, check for a `usage` field:

```typescript
case "message_end":
  if (event.usage) {
    if (event.usage.tokens != null) handle.stats.tokens += event.usage.tokens;
    if (event.usage.cost != null) handle.stats.cost += event.usage.cost;
    if (event.usage.contextFillPercent != null) {
      handle.stats.contextFillPercent = event.usage.contextFillPercent;  // latest, not cumulative
    }
  }
  this.updateSessionStats(handle);  // sync to session record
  break;
```

The `contextFillPercent` is set (not accumulated) — it represents the current fill at that point in the session.

### 3. Persistence

After each `message_end` event that carries `usage`, call `this.persist(handle)` to write the updated session record (including the stats) to `SessionRepository`. This is already done in the existing `onEvent` → `persist(handle)` flow for other state changes, so stats will be persisted on every relevant event.

Specifically, in the helper `updateSessionStats(handle)`:

```typescript
private updateSessionStats(handle: SessionHandle): void {
  handle.session.tokens = handle.stats.tokens;
  handle.session.cost = handle.stats.cost;
  handle.session.contextFillPercent = handle.stats.contextFillPercent;
  this.persist(handle);
}
```

This ensures stats are atomically persisted alongside status updates.

### 4. Session creation

When creating a session, initialize stats on the `AgentSession` record:

```typescript
const session: AgentSession = {
  // ... existing fields ...
  tokens: 0,
  cost: 0,
  contextFillPercent: 0,
  createdAt: now,
  updatedAt: now,
};
```

### 5. API exposure (GET /api/sessions/:id)

No changes needed — once the contract is updated and the service hydrates stats on the session, the API response automatically includes them. The `publicSession` function already strips internal fields but preserves the contract; stats are public.

### 6. CLI presentation (al status)

In `packages/cli/src/lib/status.ts`, extend `formatStatus` to include the three stats:

```typescript
export function formatStatus(result: SessionStatusResult): string[] {
  const { session, lastMessage } = result;
  const lines: string[] = [];

  lines.push(`${session.id}  ${session.status}`);
  // ... existing lines ...

  // NEW: stats display
  const contextFillBar = renderFillBar(session.contextFillPercent);
  lines.push(`tokens: ${session.tokens.toLocaleString()}`);
  lines.push(`cost: $${session.cost.toFixed(2)}`);
  lines.push(`context fill: ${session.contextFillPercent.toFixed(1)}% ${contextFillBar}`);

  if (session.waitingFor) {
    // ... existing code ...
  }

  return lines;
}
```

Helper for a simple visual fill bar:

```typescript
function renderFillBar(percent: number): string {
  const filled = Math.round(percent / 10);  // 0-10 chars
  const empty = 10 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}
```

Example output:
```
abc12345  running
mounts: /data/agent-land:/data/agent-land
connectors: github
model: opencode-go/deepseek-v4-pro
created: 2026-09-17T12:34:56Z
updated: 2026-09-17T12:35:22Z
last message: (none)
tokens: 45,234
cost: $0.45
context fill: 67.3% [██████░░░░]
```

The `statusJson` function automatically includes all session fields once the contract is updated, so no changes are needed there.

### 7. Live vs. stopped sessions

**Live sessions:** Stats accumulate in real time as `message_end` events arrive, and are persisted on each event. The CLI can run `al status <session-id>` mid-session and see current totals.

**Stopped sessions:** When a session stops (via `agent_settled` or explicit kill), its final stats are already persisted on the session record. On query, the API returns the immutable final values.

**Session recovery:** On server restart, the `SessionService.recover()` method reloads stopped sessions from the repository; stats are already on the record, no special logic needed.

## Interfaces

### Session contract (wire format)

```typescript
Session {
  id: string;
  status: "running" | "waiting_for_input" | "idle" | "stopped";
  tokens: number;           // NEW: cumulative tokens used
  cost: number;             // NEW: cumulative cost in USD
  contextFillPercent: number;  // NEW: current context fill (0-100)
  // ... other existing fields ...
}
```

### GET /api/sessions/:id (response)

```json
{
  "session": {
    "id": "abc12345",
    "status": "running",
    "tokens": 45234,
    "cost": 0.45,
    "contextFillPercent": 67.3,
    "model": "opencode-go/deepseek-v4-pro",
    "createdAt": "2026-09-17T12:34:56Z",
    "updatedAt": "2026-09-17T12:35:22Z"
    // ... other fields ...
  }
}
```

### GET /api/sessions/:id/events (unchanged)

Stats are not emitted as separate events — they're accumulated in the session record and visible on queries to `GET /api/sessions/:id`. The event stream carries `message_end` events with raw `usage` fields; the server is responsible for aggregation.

### al status <session-id> (CLI)

```
abc12345  running
mounts: /data/agent-land:/data/agent-land
connectors: github
model: opencode-go/deepseek-v4-pro
created: 2026-09-17T12:34:56Z
updated: 2026-09-17T12:35:22Z
last message: I've opened PR #127 with the feature note.
tokens: 45,234
cost: $0.45
context fill: 67.3% [██████░░░░]
```

### GET /api/sessions (list, unchanged)

The list already returns all fields on each session, so stats are included automatically.

## Risks & mitigations

### Risk 1: Stats become stale if message_end parsing fails

**Impact:** If pi stops emitting `usage` in `message_end`, or if the event stream is interrupted, cumulative stats freeze at their last-known value. A restarted session will have stale totals.

**Mitigation:** Document this clearly. The stats are only as fresh as the event stream. If a session is recovered after a redeploy, its in-memory counters are reset to the persisted values, which may lag behind reality if events were lost during the outage. This is acceptable — it matches the behavior of the kill-switch (ADR 011), which also stops working if pi stops emitting `usage`[^kill-switch].

### Risk 2: context-fill % semantics are unclear

**Impact:** If pi emits `contextFillPercent` directly, great. If not, we need to derive it from token count + model context window. The calculation may diverge from pi's internal tokenizer, causing confusion.

**Mitigation:** Implement both cases: (1) If pi emits `contextFillPercent`, use it unchanged. (2) If not, compute as `(tokens used) / (model context window)` using provider config. Document the source clearly in the stat. For now, assume pi emits it — if not, update this in implementation.

### Risk 3: Schema migration for existing stopped sessions

**Impact:** Adding three required fields to the Session schema means all persisted sessions must have these fields when deserialized. Existing stopped sessions in the repository may lack them.

**Mitigation:** During migration, use a database script or server-side upgrade to backfill missing fields with default values (0, 0, 0). Alternatively, make fields optional on deserialization with defaults, then require them on output. This is a standard zod pattern.

### Risk 4: Numeric precision for cost

**Impact:** Floating-point arithmetic on cost can introduce rounding errors over many operations.

**Mitigation:** Store cost as a number (not a string), accept the inherent floating-point precision limits, and document it. For the CLI, round to 2 decimal places for display (USD convention). This matches how pi's RPC emits cost.

### Risk 5: Stats are queried but not validated by the orchestrator

**Impact:** The orchestrator (Phase 4) will read stats to enforce soft budgets, but there's no server-side validation that a child's final stats match what the orchestrator expects. A malicious or buggy child could claim false stats.

**Mitigation:** This is a composition concern — the orchestrator is responsible for trusting and auditing child stats. The server has no enforcement role. If the orchestrator needs confidence, it can cross-check against the event log (replay `message_end` events and sum). For now, accept that stats are trust-based and document it.

## ADR pointers

- **ADR 011** [^kill-switch]: Per-run kill switches are enforced via `message_end` parsing; stats are the source of truth for that enforcement. This feature makes those stats queryable and observable.
- **Dynamic Orchestration design** [^dynamic-orch]: Phase 4 reads session stats to account actual spend against orchestrator-held soft budgets per stage and per run. This feature enables that read path.
- **ADR 017** (Product Layer OKF Memory): This feature is pure composition — no engine change, no new primitives. The six primitives (Session, Event Stream, Mount, Connector, Provider, Container) already carry the necessary data; the platform just surfaces it.

## Minimal change set

**Files touched:**

1. `packages/contracts/src/session.ts`
   - Add `tokens: z.number()`, `cost: z.number()`, `contextFillPercent: z.number()` to `sessionSchema`.
   - Add corresponding fields to `AgentSession` type (if internal type differs).

2. `packages/server/src/core/session-service.ts`
   - Extend `SessionHandle.stats` with `{ tokens, cost, contextFillPercent }`.
   - Initialize stats in `createSession` and `recover`.
   - Add `updateSessionStats(handle)` helper and call it in `onEvent` when `message_end` arrives.
   - No changes to kill-switch logic — stats and kill-switch are independent concerns.

3. `packages/server/src/core/types.ts`
   - Add `tokens`, `cost`, `contextFillPercent` to `AgentSession` interface.

4. `packages/cli/src/lib/status.ts`
   - Extend `formatStatus` to display the three stats with formatting.
   - Add `renderFillBar` helper for visual context-fill display.

5. `packages/server/src/presentation/http/api-sessions.ts`
   - No changes — stats are already on the contract and returned by `publicSession`.

6. Database migration (if applicable)
   - Backfill `tokens`, `cost`, `contextFillPercent` with defaults (0, 0, 0) for all existing sessions.

**Tests to add:**

- Unit: `SessionHandle` stat accumulation with mock `message_end` events.
- Integration: Create a session, emit `message_end` events with usage, verify stats appear on `GET /api/sessions/:id`.
- Integration: Stop a session, verify stats persist and are visible on query after restart.
- CLI: `al status` output includes stats with correct formatting.

**No changes to:**

- Engine primitives (Session is primitive 4; adding fields does not change its role).
- Event stream (existing `message_end` event format unchanged).
- Kill-switch logic (ADR 011 remains unchanged).
- API routing or error handling.
- Orchestrator recipe (Phase 4 design already assumes stats will be available; no new code needed here).

## Answers to Feature note open questions

**Q1: Stat accumulation — real-time vs. on-demand?**

*Answer:* **Real-time in `SessionHandle` with atomic persistence.** Each `message_end` event triggers an increment and a persist, so live sessions always show current totals mid-turn. This enables real-time cost monitoring and matches the kill-switch pattern (ADR 011), which also reads `message_end` in real time.

**Q2: Context-fill % calculation.**

*Answer:* **Assume pi emits it directly in `get_session_stats`.** If pi doesn't, implement fallback: compute as `(tokens used) / (model context window)` by looking up the model's context length from the provider config. Document the source clearly in the CLI output (e.g., "context fill: 67.3% (pi-emitted)" or "context fill: 67.3% (estimated from provider config)"). This is deferred to implementation.

**Q3: API shape — nested vs. top-level stats.**

*Answer:* **Top-level fields.** The three fields (`tokens`, `cost`, `contextFillPercent`) are added directly to the Session contract at the top level, not nested. This simplifies the CLI, matches the contract structure, and aligns with the existing Session semantics.

**Q4: CLI presentation — single line or multi-line, with warnings?**

*Answer:* **Multi-line, human-readable format with optional warnings.** The default `al status` output includes three new lines (tokens, cost, context fill with a simple fill bar). Warnings (e.g., "⚠️  context fill > 80%") are a separate concern and deferred to Phase 5. For this feature, prioritize clarity over richness.

**Q5: Tree stats — aggregate over orchestrator + children?**

*Answer:* **Out of scope.** Single-session stats are sufficient here. Tree stats (total spend for an orchestrator run + all children) will be computed by the orchestrator during Phase 4 and are not a server responsibility.

**Q6: Kill switch vs. stats exposure.**

*Answer:* **No server-side hard kill-switches; stats exposure only.** This feature makes stats visible to both the operator (via `al status`) and the orchestrator (via API query). ADR 011's per-run kill switches (enforced by pi's `message_end` parsing) remain pi's responsibility. The orchestrator (Phase 4) will read these stats and enforce **soft** orchestrator-side budgets by deleting over-budget children. The server has no role in hard enforcement.

---

[^kill-switch]: [Per-Run Kill-Switch ADR](/adrs/011-kill-switch.md) — incremental token/cost tracking via `message_end` parsing.
[^dynamic-orch]: [Dynamic Orchestration design](/product/designs/dynamic-orchestration-design.md) — orchestrator-side soft budget enforcement by reading child stats (§Interfaces 1).
