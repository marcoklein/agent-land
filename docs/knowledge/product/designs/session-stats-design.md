---
type: Design
title: Session stats — tokens, cost, context fill
description: Extend the Session contract and pi RPC harness to accumulate and expose pi's get_session_stats (tokens, cost, context%) through GET /api/sessions/:id and al status, for operator observability and orchestrator budget enforcement.
status: draft
generated: { by: opencode/pi, at: 2025-01-15T00:00:00Z }
sources:
  - id: feature
    resource: /product/features/session-stats.md
    title: Session stats Feature note
  - id: kill-switch
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: dynamic-orchestration
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration design — budget accounting
  - id: cli-observability
    resource: /product/designs/cli-observability-design.md
    title: CLI session observability — al log --json, al status
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the six primitives
  - id: session-contract
    resource: packages/contracts/src/session.ts
    title: Session record schema
  - id: event-contract
    resource: packages/contracts/src/event.ts
    title: Session event schema
  - id: pi-rpc-harness
    resource: packages/server/src/infra/pi-rpc-harness.ts
    title: Docker exec pi RPC harness
  - id: session-route
    resource: packages/server/src/presentation/http/api-sessions.ts
    title: GET /api/sessions/:id route
  - id: status-lib
    resource: packages/cli/src/lib/status.ts
    title: CLI status command (from cli-observability design)
---

# Session stats — design

## Approach

This design extends the platform's observation model (Event Stream and Session record) with pi's session statistics — cumulative tokens consumed, cost accrued, and context-fill percentage per session. The platform collects stats from pi via an optional `get_session_stats` RPC call and stores them in the Session record; both the JSON/SSE API and CLI (`al status`) expose the stats. No new engine primitives are added; stats remain purely observational data projected from pi's RPC interface.

The strategy unfolds in three layers:

1. **Contract extension** — add optional `usage` object to the `Session` schema (tokens, cost, context%).
2. **Server-side accumulation** — the pi RPC harness calls `get_session_stats` on demand when a client requests `GET /api/sessions/:id`, and caches the result in the session record. For live sessions, stats are fetched on each read (guaranteeing freshness); for stopped sessions, stats are final.
3. **CLI integration** — extend `packages/cli/src/lib/status.ts` (from cli-observability-design) to fetch and display the stats alongside the session record and last message.

### Why on-demand, not streaming?

The feature note asked whether stats should stream in `message_end` events or be fetched on-demand. We choose **on-demand RPC** (`get_session_stats` call per `GET /api/sessions/:id`) for these reasons:

- **Simplicity.** Pi's `message_end` events carry the message itself; adding usage metadata to every event couples the message stream to accounting, violating separation of concerns. An explicit RPC is cleaner.
- **Freshness guarantee.** For live sessions, calling `get_session_stats` on read gives the operator a real-time view of spend *right now*, not the last event that arrived seconds ago. This is essential for budget guardrails — operators need to see current spend before deciding to kill a run.
- **Future extensibility.** If pi later provides per-turn, per-tool usage breakdowns, a dedicated stats RPC scales better than multiplexing into event streams.
- **Deferred streaming optimization.** ADR 011 (kill-switch) and the dynamic orchestrator can later subscribe to `message_end` events *as an optimization* if pi emits usage there; this design does not block that, it just doesn't require it.

## Interfaces

### 1. Session contract extension (packages/contracts/src/session.ts)

Add an optional `usage` field to the session schema:

```ts
export const usageSchema = z
  .object({
    tokens: z.number().describe("Cumulative tokens consumed (input + output) across all turns."),
    cost: z.number().describe("Cumulative cost accrued ($) across all turns."),
    contextFill: z.number().describe("Context-fill percentage (0–100), = tokens / model.maxContext * 100, clamped."),
  })
  .describe("Session token usage and cost statistics from pi.");
export type Usage = z.infer<typeof usageSchema>;

// Extend sessionSchema:
export const sessionSchema = z
  .object({
    id: z.string().describe("Unique session id."),
    status: sessionStatusSchema,
    // ... existing fields ...
    usage: usageSchema.optional().describe("Token usage, cost, and context fill; present if fetched from pi."),
  })
  .describe("An agent session (the single entity of the platform).");
```

Notes:
- `usage` is optional because not all session reads will have called `get_session_stats` yet.
- `tokens` is the sum of input and output tokens across all turns (cumulative).
- `cost` is the accrued cost in dollars across all turns, based on the provider's pricing for the model.
- `contextFill` is a percentage (0–100) computed as `(tokens / modelMaxContext) * 100`, clamped to [0, 100]. The "model max context" is looked up from the session's model definition (see **Risk & mitigation: model discovery**).

### 2. Pi RPC harness — on-demand fetch

The pi RPC harness is stateless and streams only events. To fetch stats, the **session service** (which owns the session record and orchestrates calls to the harness) must call an optional new RPC method.

**Assumption:** Pi provides a `get_session_stats() -> { tokens: number, cost: number, contextFill?: number }` RPC method. If pi does not yet emit this, the platform will call it as a polling query (once per `GET /api/sessions/:id`). If pi later begins emitting stats in `message_end` events, the harness can cache them in-memory and return the cached value on the next `get_session_stats` call without a round-trip.

**Harness changes (minimal):**

The `AgentHandle` interface (returned by `PiRpcHarness.start`) already supports a `write` method for sending RPC commands. No changes to the harness structure are needed; the session service will call a new `getStats` method on the handle (or construct and send the RPC directly).

### 3. Session service — fetch and cache stats

The session service (or HTTP layer, `packages/server/src/presentation/http/api-sessions.ts`) extends `GET /api/sessions/:id` to fetch and attach stats:

**Pseudo-code (packages/server/src/presentation/http/api-sessions.ts):**

```ts
import { Usage } from "@agent-land/contracts";

async function getSession(sessionId: string): Promise<{ session: Session & { usage?: Usage } }> {
  const session = await sessionStore.get(sessionId);
  if (!session) throw new NotFoundError();

  // Fetch stats from pi if the session is active.
  if (session.status === "running") {
    try {
      const handle = sessionHandles.get(sessionId);
      if (handle) {
        const stats = await handle.getStats?.();
        if (stats) {
          session.usage = stats;
        }
      }
    } catch (err) {
      // Log the error but do not fail the request — stats are best-effort.
      console.warn(`Failed to fetch stats for session ${sessionId}:`, err);
    }
  } else if (session.status === "stopped" && !session.usage) {
    // For stopped sessions, call get_session_stats once and cache it in the record.
    try {
      const handle = sessionHandles.get(sessionId);
      if (handle) {
        const stats = await handle.getStats?.();
        if (stats) {
          session.usage = stats;
          // Persist the stats to the session record so we don't re-fetch on every read.
          await sessionStore.update(sessionId, { usage: stats });
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch stats for stopped session ${sessionId}:`, err);
    }
  }

  return { session };
}
```

**Design notes:**
- For **live sessions** (`running`), fetch stats on every read. This guarantees freshness for budget enforcement.
- For **stopped sessions**, fetch once and cache in the session record. This avoids repeated calls to a session handle that may no longer be alive.
- Stats are **optional and best-effort** — if pi is unavailable or the harness does not support the RPC, the session record is returned without stats. The client must handle missing `usage`.
- **Error handling:** Log errors but do not fail the request. Observability should not block access to the session.

### 4. CLI integration — extend al status

The `packages/cli/src/lib/status.ts` module (from cli-observability-design) is extended to display usage:

**Interfaces (no change to signature):**

```ts
export interface SessionStatusResult { 
  session: Session & { usage?: Usage };  // usage is now optional here
  lastMessage: string;
}
```

**Human format output (formatStatus):**

```ts
export function formatStatus(result: SessionStatusResult): string[] {
  const { session, lastMessage } = result;
  const lines: string[] = [];
  
  lines.push(`${session.id}  ${session.status}`);
  
  if (session.mounts && session.mounts.length > 0) {
    lines.push(`mounts: ${session.mounts.map(m => `${m.source}:${m.target}`).join(", ")}`);
  } else {
    lines.push("mounts: (none)");
  }
  
  if (session.connectors && session.connectors.length > 0) {
    lines.push(`connectors: ${session.connectors.join(", ")}`);
  } else {
    lines.push("connectors: (none)");
  }
  
  lines.push(`model: ${session.provider ? session.provider + "/" : ""}${session.model}`);
  lines.push(`created: ${session.createdAt}`);
  lines.push(`updated: ${session.updatedAt}`);
  
  // NEW: usage stats
  if (session.usage) {
    lines.push(`tokens: ${session.usage.tokens.toLocaleString()}`);
    lines.push(`cost: $${session.usage.cost.toFixed(2)}`);
    lines.push(`context: ${session.usage.contextFill}%`);
  }
  
  if (lastMessage) {
    lines.push(`last message: ${lastMessage}`);
  } else {
    lines.push("last message: (none)");
  }
  
  if (session.waitingFor) {
    const prompt = session.waitingFor.prompt ? ` — ${session.waitingFor.prompt}` : "";
    lines.push(`waiting for: ${session.waitingFor.method}${prompt}`);
  }
  
  return lines;
}
```

**JSON format output (statusJson):**

```ts
export function statusJson(result: SessionStatusResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}
```

(No change — the full `SessionStatusResult` is already emitted, now including `session.usage`.)

### 5. API surface

**No new endpoint.** The existing `GET /api/sessions/:id` now returns the session record with an optional `usage` field. The JSON response shape is:

```json
{
  "session": {
    "id": "abc123",
    "status": "running",
    "model": "gpt-4",
    "provider": "opencode-go",
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-15T11:45:30Z",
    "mounts": [{ "source": "agent-land", "target": "/data/agent-land" }],
    "connectors": ["github"],
    "usage": {
      "tokens": 45230,
      "cost": 0.32,
      "contextFill": 42
    }
  }
}
```

## Answers to the Feature note's open questions

1. **`get_session_stats` contract.** We assume pi provides an RPC method `get_session_stats()` returning `{ tokens: number, cost: number, contextFill?: number }` as a cumulative snapshot per session. If pi's `message_end` events also carry usage, the platform can optimize by extracting and caching them; this design does not require that streaming, only supports it as a future optimization. The exact contract with pi is **deferred pending pi documentation** — link the ADR or a learnings note once the RPC is documented.

2. **Platform stats accumulation strategy.** On-demand RPC (`get_session_stats` call per read). For live sessions, fetch on every `GET /api/sessions/:id` (fresh stats, required for budget enforcement). For stopped sessions, fetch once and cache in the record. This avoids polling without sacrificing freshness for operators.

3. **API shape — extend Session or dedicated endpoint.** Extend `GET /api/sessions/:id` to include optional `usage` field on the session record. No new endpoint (`/stats`). This keeps the session as a single, authoritative projection of pi's state.

4. **Real-time vs. last-known for live sessions.** Real-time (on-demand RPC). Each `GET /api/sessions/:id` call for a live session triggers a fresh `get_session_stats` call, guaranteeing operators see the latest spend. For stopped sessions, the final stats are cached in the record.

5. **CLI command shape.** No new command. Extend `al status <session-id>` (from cli-observability-design) to display usage lines alongside the existing session record. The human output adds three lines (`tokens`, `cost`, `context`); `al status --json` includes the full `session` object with `usage`.

6. **Accuracy for multi-turn sessions.** `get_session_stats` returns cumulative totals across all turns *at the moment of the call*. This is the contract we assume from pi. The platform makes no distinction between single and multi-turn sessions — it simply passes through pi's cumulative count.

7. **Context-fill calculation.** `contextFill = (tokens / modelMaxContext) * 100`, clamped to [0, 100]. The "model max context" is looked up from the session's model at fetch time. If the model definition cannot be resolved (e.g., custom model), `contextFill` is omitted from usage stats (logged as a warning). This is a **runtime dependency on model discovery** (see Risks & mitigations).

## Risks & mitigations

### Risk: Model discovery at stats-fetch time

**The problem:** Computing `contextFill` requires the model's max context window. The session record stores only the model *name* (e.g., `gpt-4`), not its metadata. At stats-fetch time, we must look up the model definition to get the context window.

**Mitigation:** 
- Call the model discovery service (see `docs/knowledge/providers/model-discovery.md`) at fetch time to resolve the model.
- If resolution fails (model unknown, provider offline), log a warning and omit `contextFill` from the usage object. Return partial stats rather than failing the entire request.
- Cache the resolved model metadata in memory for the duration of the session (model doesn't change mid-session), so we don't re-query on every `GET /api/sessions/:id`.
- **Explicitly defer:** Storing rich model metadata in the session record to avoid runtime lookups is a separate design decision (scope: session record schema stabilization). For now, accept the lookup cost.

### Risk: Stale stats on stopped sessions

**The problem:** We cache stats in the session record for stopped sessions (to avoid re-querying a dead handle). If a session is stopped very quickly (e.g., timeout on the first turn), the cached stats might be incomplete.

**Mitigation:**
- Fetch stats *immediately* when the session stops (in the session service's `stop` handler). This ensures we capture final stats while the harness is still alive.
- If the fetch fails, leave `usage` empty and log an error. The session is still readable; stats are just missing.
- **Explicitly defer:** A "wait-for-final-stats" gate before session deletion is a separate concern (would require extending the session lifecycle). For now, best-effort caching is acceptable.

### Risk: Performance impact of RPC calls on every read

**The problem:** Calling `get_session_stats` on every `GET /api/sessions/:id` for a live session adds latency and potential load on pi.

**Mitigation:**
- The harness (pi RPC) runs in the same Docker container as the agent, so the RPC is a local inter-process call (< 1 ms). Latency is negligible.
- For busy sessions (streaming text, tool calls), `get_session_stats` is a synchronous, non-blocking query of pi's in-memory state (no I/O).
- **Optimization deferred:** If pi later emits usage in `message_end` events, the harness can cache the latest value and return it synchronously from `get_session_stats` without a round-trip. This is a future optimization that does not change the API contract.

### Risk: Breakage if pi does not yet support `get_session_stats`

**The problem:** The platform assumes pi provides a `get_session_stats` RPC. If pi does not yet, the calls will fail.

**Mitigation:**
- Check pi's RPC interface documentation and verify `get_session_stats` exists before implementation.
- If pi does not provide it, open an issue against pi to add it (or add it directly if pi is in-tree).
- For now, this is a **blocking prerequisite check**: do not merge this design until pi's `get_session_stats` RPC is confirmed to exist and is documented.

### Risk: Unbounded context-fill percentage

**The problem:** If tokens consumed exceeds the model's max context, `contextFill` would exceed 100%. This can happen if pi emits tokens for previous turns that are not stored in the context window (e.g., compressed, summarized).

**Mitigation:**
- Clamp `contextFill` to [0, 100]. If computed percentage exceeds 100%, cap it at 100% and log a warning (this signals an issue in token accounting or model metadata).

## ADR pointers

No new ADR required. This design composes from existing primitives (Session record, Event Stream, RPC interface to pi) and extends the observation model defined in ADR 014 (JSON API as the canonical machine interface)[^adr-014]. The on-demand RPC strategy aligns with the engine's principle of projection (the platform observes what pi emits or provides via RPC; it never synthesizes heuristics).

**Cross-reference existing ADRs:**
- ADR 011 (Kill-Switch) — this design unblocks per-run token/cost enforcement by exposing the stats that ADR 011 reads.
- ADR 014 (JSON API is the canonical machine interface) — `GET /api/sessions/:id` extends the session JSON envelope with optional usage; `al status --json` follows the NDJSON convention.

**Learnings to capture (after implementation):**
- Document pi's `get_session_stats` RPC contract (if not already documented) in `docs/knowledge/learnings/pi-rpc.md` or a new `docs/knowledge/providers/pi-stats.md`.
- Document the model discovery lookup at stats-fetch time in `docs/knowledge/learnings/model-discovery.md` if performance characteristics are noteworthy.

## Minimal change set

### Contracts
- **`packages/contracts/src/session.ts`** — add `usageSchema` and extend `sessionSchema` with optional `usage` field.

### Server
- **`packages/server/src/presentation/http/api-sessions.ts`** — extend `GET /api/sessions/:id` handler to call `handle.getStats?.()` for live sessions and cache for stopped sessions. Import model discovery service; resolve and cache model metadata for `contextFill` computation. Return session with optional `usage`.
- **`packages/server/src/infra/pi-rpc-harness.ts`** — add a `getStats` method to `AgentHandle` (or expose it via the RPC write interface). This method sends a `get_session_stats` RPC command to pi and waits for the response.

### CLI
- **`packages/cli/src/lib/status.ts`** — extend `formatStatus` to display usage lines (`tokens: <n>`, `cost: $<x>`, `context: <n>%`) when `session.usage` is present. No change to `statusJson` (it already includes the full session object). Update `SessionStatusResult` and `StatusClient` types to include `Usage` type.

### Types and exports
- **`packages/cli/src/lib/types.ts`** (or wherever Usage is imported) — import `Usage` from contracts; re-export if needed.

### Tests
- **`packages/server/src/__tests__/api-sessions.test.ts`** — add test cases:
  - `GET /api/sessions/:id` for a live session calls `getStats` and includes `usage` in the response.
  - `GET /api/sessions/:id` for a stopped session includes cached `usage` from the record.
  - Missing `usage` when `getStats` is not available (graceful degradation).
  - Model discovery failure logs a warning but does not fail the request.
- **`packages/cli/src/lib/status.test.ts`** — extend test cases:
  - `formatStatus` with `usage` present displays the three stats lines.
  - `formatStatus` with `usage` missing omits the stats lines.
  - `statusJson` includes the full session object with `usage` when present.

### Documentation
- **`docs/knowledge/platform/cli.md`** — document the new `al status` output lines showing usage (already partially done in cli-observability-design; just confirm it's there).
- **`docs/knowledge/adrs/011-kill-switch.md`** (or a new ADR) — clarify that kill-switch enforcement will read `GET /api/sessions/:id?usage=true` or similar (deferred; the kill-switch implementation will decide).

### Not touched
- Engine primitives, event stream, session lifecycle.
- Mount or connector logic.
- Provider or model selection (model discovery is a dependency, not a change).

## Implementation order

1. Extend `packages/contracts/src/session.ts` with `usageSchema` and update `sessionSchema`.
2. Verify pi's `get_session_stats` RPC contract (documentation check; no code yet).
3. Add `getStats` method to `AgentHandle` in `packages/server/src/infra/pi-rpc-harness.ts`.
4. Extend `packages/server/src/presentation/http/api-sessions.ts` to call `getStats` and attach usage.
5. Extend `packages/cli/src/lib/status.ts` to display usage lines.
6. Add test coverage.
7. Document the pi RPC contract in `docs/knowledge/learnings/`.

---

## Summary

This design exposes pi's session stats (tokens, cost, context-fill) to the platform's API and CLI by:
1. Extending the Session contract with optional `usage` object.
2. Fetching stats on-demand via pi's `get_session_stats` RPC when the session record is read.
3. Displaying stats in `al status` and the JSON API without adding new endpoints or commands.

The approach is conservative — no new engine primitives, no event stream changes — and aligns with the platform's observation model: stats are a projection of what pi provides, accessible via its RPC interface, and exposed to operators via the canonical JSON API and CLI. This unblocks ADR 011 (kill-switch enforcement) and the dynamic orchestrator's per-stage budget accounting.

[^adr-014]: [ADR-014 — JSON API is the canonical machine interface](/adrs/014-json-api-canonical-machine-interface.md)
