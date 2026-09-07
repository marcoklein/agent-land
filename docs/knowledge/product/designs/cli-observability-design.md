---
type: Design
title: CLI session observability — al log --json, al status
description: Lock `al log --json`'s newline-delimited JSON shape with tests and add `al status <id> [--json]`, both built purely from the existing session record and SSE event stream (no server change).
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-07T20:08:34Z }
sources:
  - id: feature
    resource: /product/features/cli-observability.md
    title: CLI session observability Feature note
  - id: cli-entry
    resource: packages/cli/src/agent-land.ts
    title: "`al` entrypoint — logSession and command dispatch"
  - id: api-client
    resource: packages/cli/src/lib/api.ts
    title: ApiClient — getSession / eventsUrl / authHeader
  - id: sse
    resource: packages/cli/src/lib/sse.ts
    title: SSE parsing and streaming
  - id: ops
    resource: packages/cli/src/lib/ops.ts
    title: runSession / watchSession / createSeqFilter test seams
  - id: render
    resource: packages/cli/src/lib/render.ts
    title: messageText + createEventRenderer
  - id: args
    resource: packages/cli/src/lib/args.ts
    title: parseArgs — COMMANDS / COMMAND_FLAGS
  - id: session-contract
    resource: packages/contracts/src/session.ts
    title: Session record schema (status, connectors, mounts, model, provider)
  - id: event-contract
    resource: packages/contracts/src/event.ts
    title: Session event schema (SsePayload = SessionEvent & { seq? })
  - id: events-route
    resource: packages/server/src/presentation/http/api-sessions.ts
    title: GET /api/sessions/:id/events (SSE replay + live)
  - id: cli-docs
    resource: /cli.md
    title: CLI (`al`) reference
  - id: adr-014
    resource: /adrs/014-json-api-canonical-machine-interface.md
    title: JSON API is the canonical machine interface
---

# CLI session observability — design

Ground truth verified against `main` at `eaf26af`: `al log <id> [--follow] [--json]` already exists in `packages/cli/src/agent-land.ts` (`logSession`), already emits newline-delimited JSON (`JSON.stringify(parsed) + "\n"`) with the `data: ` prefix stripped by `parseSseEvent`, `agent-done`/`: ping` frames suppressed, and `seq` deduped via `createSeqFilter`. `al status` does not exist. `ApiClient` already exposes `getSession(id): Promise<SessionEnvelope>` (returns `{ session: Session }`) alongside `eventsUrl(id)` and `authHeader`[^api-client][^cli-entry][^session-contract]. The server's `GET /api/sessions/:id/events` replays the full `seq`-sequenced snapshot, then either ends with `event: agent-done` (session stopped at start, or on a live `status: stopped`) or stays open streaming live events with `: ping` heartbeats[^events-route].

So the real delta is: (1) extract `logSession` behind an injectable test seam and lock its `--json` shape with tests, and (2) add `al status` built from `getSession` + one replay of the event stream. No server change.

## Approach

Two additive, non-behavior-changing CLI changes plus one small refactor for testability:

1. **`al log --json` testability (refactor only).** Move the existing `logSession` out of `agent-land.ts` into a new `packages/cli/src/lib/log.ts`, parameterized exactly like the existing `runSession`/`watchSession` seams: `out` (defaults `process.stdout`) and `stream` (defaults `streamSse`)[^ops]. The body is a byte-for-byte move — the 500 ms "quiet stop" heuristic, the `agent-done` short-circuit, the `seq` dedupe, and the `json` vs renderer output branches are unchanged. This gives the `--json` shape a unit-testable seam without re-deciding any semantics.

2. **`al status <id> [--json]` (additive).** A new `packages/cli/src/lib/status.ts`:
   - a **pure** reducer `lastAssistantText(events)` mirroring `runSession`'s final-message extraction (`messageText(event.message)`, falling back to accumulated `message_delta` streamed text);
   - an orchestration function `getSessionStatus(client, sessionId, { stream? })` that fetches the session record, replays the event stream once through `createSeqFilter`, and returns `{ session, lastMessage }`; and
   - two formatters, `formatStatus` (human lines) and `statusJson` (single pretty-printed object).
   `agent-land.ts` gets a `status` dispatch branch and a `status` entry in the `USAGE` block.

3. **Docs.** `docs/knowledge/cli.md` gains the `al status` command and an explicit statement of `al log`'s no-`--follow` semantics (see *Open questions* #2)[^cli-docs].

## Interfaces

### CLI surface (unchanged behavior, new command)

`USAGE` and `docs/knowledge/cli.md` gain:

```
al status <session-id> [--json]
      print a session's status, mounts, connectors, model, and last assistant message

al log <session-id> [--follow] [--json]
      print the event history; --follow keeps tailing, --json prints raw events (one JSON per line)
```

`al status` human output is fixed as (one line each):

```
<id>  <status>
mounts: <source>:<target>, … | (none)
connectors: <name>, … | (none)
model: [<provider>/]<model>
created: <createdAt>
updated: <updatedAt>
last message: <text> | (none)
waiting for: <method>[ — <prompt>]        # only when waitingFor is present
```

`al status --json` emits exactly one object, pretty-printed: `JSON.stringify({ session, lastMessage }, null, 2) + "\n"` where `session` is the raw `Session` record from `GET /api/sessions/:id` and `lastMessage` is the extracted text (string, possibly empty). This matches `al ls --json`'s pretty-print convention and ADR-014's machine-interface intent[^adr-014].

### `packages/cli/src/lib/args.ts`

- `COMMANDS`: add `"status"`.
- `COMMAND_FLAGS`: add `status: ["--json"]`.

### `packages/cli/src/lib/ops.ts`

Export the two module-private types so sibling libs reuse them (no behavior change):

```ts
export type StreamFn = (url: string, opts: { authHeader?: string; signal?: AbortSignal }) => AsyncGenerator<SseEvent>;
export interface SessionClient { eventsUrl: (id: string) => string; authHeader?: string; respond: (...): Promise<unknown>; }
```

(`log.ts` and `status.ts` define their own *narrower* client interfaces — see below — so the existing `SessionClient` stays as-is for `runSession`/`watchSession`; only `StreamFn` is genuinely shared.)

### `packages/cli/src/lib/log.ts` (new — moved `logSession`)

```ts
export interface LogClient { eventsUrl: (id: string) => string; authHeader?: string }
export interface LogOptions { json?: boolean; follow?: boolean; out?: { write: (text: string) => void }; stream?: StreamFn }
export async function logSession(client: LogClient, sessionId: string, opts?: LogOptions): Promise<void>
```

Body identical to today's `logSession` in `agent-land.ts`, with `process.stdout` → `out` and `streamSse` → `stream`. `agent-land.ts` imports and calls it as `logSession(client, sessionId, { json: opts.json, follow: opts.follow })`.

### `packages/cli/src/lib/status.ts` (new)

```ts
import { streamSse } from "./sse.js";
import { messageText } from "./render.js";
import { createSeqFilter, type StreamFn } from "./ops.js";
import type { AgentEvent, Session } from "./types.js";

export interface SessionStatusResult { session: Session; lastMessage: string }

export interface StatusClient {
  getSession: (id: string) => Promise<{ session: Session }>;
  eventsUrl: (id: string) => string;
  authHeader?: string;
}

/** Pure reducer: last completed assistant message, runSession-style fallback. */
export function lastAssistantText(events: Iterable<AgentEvent>): string {
  let streaming = "";
  let last = "";
  for (const ev of events) {
    if (ev.type === "turn_start") streaming = "";
    else if (ev.type === "message_delta") streaming += ev.text ?? "";
    else if (ev.type === "message_end") {
      const text = messageText(ev.message) || streaming;
      if (text) last = text;
      streaming = "";
    } else if (ev.type === "agent_settled") {
      if (!last && streaming) last = streaming;
      streaming = "";
    } else if (ev.type === "turn_end") {
      streaming = "";
    }
  }
  return last;
}

/** Fetch the record, replay the stream once, return record + last message. */
export async function getSessionStatus(
  client: StatusClient,
  sessionId: string,
  { stream = streamSse }: { stream?: StreamFn } = {}
): Promise<SessionStatusResult>
```

`getSessionStatus` implementation contract (so the implementer does not re-decide):

1. `const { session } = await client.getSession(sessionId);` — a 404 surfaces here (ApiClient throws `Error` with `status`), and the dispatch branch turns it into `fail("status failed: …")`.
2. Create `const dedupe = createSeqFilter();`, `const events: AgentEvent[] = [];`, an `AbortController ac`, and a `stop` flag.
3. Arm the quiet-stop **once up front** (before the loop) and re-arm it after every parsed data event: clear the previous timer, then `setTimeout(() => { stop = true; ac.abort(); }, 500)`. Arming up front bounds the empty-history case (a live session with zero events would otherwise stream only `: ping` heartbeats forever).
4. Single pass: `for await (const ev of stream(client.eventsUrl(sessionId), { authHeader: client.authHeader, signal: ac.signal }))`:
   - `if (ev.event === "agent-done") break;`
   - `if (ev.data === undefined) continue;` (this is where `: ping` comments are already gone — `parseSseEvent` drops them[^sse])
   - `JSON.parse(ev.data)` in try/catch `continue`;
   - `if (dedupe(parsed)) continue;`
   - `events.push(parsed); scheduleQuietStop();`
5. `catch (err)`: rethrow unless the abort was our own quiet-stop (`if (!stop) throw err`). Clear the timer in a `finally`.
6. `return { session, lastMessage: lastAssistantText(events) };`

No reconnect loop and no `--follow` — `al status` is strictly one replay pass that ends on `agent-done`, on stream end (injected fake), or on the 500 ms quiet-stop.

```ts
export function formatStatus(result: SessionStatusResult): string[];   // the human lines above
export function statusJson(result: SessionStatusResult): string;       // JSON.stringify({ session, lastMessage }, null, 2) + "\n"
```

### `packages/cli/src/agent-land.ts` (dispatch + USAGE only)

- Remove the inline `logSession`; import it from `./lib/log.js`.
- Import `getSessionStatus, formatStatus, statusJson` from `./lib/status.js`.
- Add the `status` branch (alongside `log`):

```ts
} else if (cmd === "status") {
  const sessionId = positional[0];
  if (!sessionId) fail("status requires a session id");
  try {
    const result = await getSessionStatus(client, sessionId);
    if (opts.json) process.stdout.write(statusJson(result));
    else for (const line of formatStatus(result)) process.stdout.write(line + "\n");
  } catch (err) {
    fail(`status failed: ${(err as Error).message}`);
  }
}
```

`client` (the full `ApiClient`) structurally satisfies `StatusClient` and `LogClient`[^api-client].

### Tests (vitest, `pnpm --filter @agent-land/cli test`)

- **`packages/cli/src/lib/log.test.ts`** (new) — reuse the `fakeStream`/`makeClient` pattern from `ops.test.ts`, capturing `out.write`[^ops]:
  - json mode: each data event becomes exactly one `JSON.stringify(parsed) + "\n"` line (no `data: ` prefix, no extra newlines);
  - an `event: agent-done` frame is never printed;
  - a duplicate `seq` (e.g. `12` twice) is printed once;
  - non-json mode delegates to the renderer (assert a `turn_start` renders a line, smoke-level).
  - Note: `data: `-prefix stripping and `: ping` dropping are already covered by `sse.test.ts`; these tests only lock the loop's behavior.
- **`packages/cli/src/lib/status.test.ts`** (new):
  - `lastAssistantText`: `message_end` with `message` text → that text; `message_end` with `message: null` after deltas → streamed text; two turns → last completed turn's text; mid-turn (deltas, no `message_end`) → previous completed text or `""`; `agent_settled` fills from streaming only when nothing finalized.
  - `getSessionStatus`: fake `getSession` returns a record; fake finite stream returns `{ session, lastMessage }`; dedupe applied; stops on `agent-done`; rethrows a stream error carrying `status` (404) untouched.
  - `formatStatus`: mounts rendered as `source:target`, `(none)` for empty mounts/connectors/last-message; `waiting for:` line only when `waitingFor` present.
  - `statusJson`: single object containing `session` and `lastMessage`.
- **`packages/cli/src/lib/args.test.ts`** (extend): `parseArgs(["status", "abc12345", "--json"])` → `{ cmd: "status", opts: { json: true }, positional: ["abc12345"] }`; `parseArgs(["status", "abc", "--follow"])` throws `UsageError` (not a status flag).

## Risks & mitigations

- **`al status` on a busy running session can lag.** The quiet-stop re-arms on every data event, so a mid-turn session streaming deltas without a 500 ms gap keeps the replay open (same trade-off `al log` already makes). *Mitigation:* the fetched record is authoritative for `status` (`running` shows immediately once the loop returns); in practice turns emit deltas in bursts separated by tool-call latency ≫ 500 ms, so the replay ends within a second or two. A future server `?replay=1`-style "snapshot only, then close" query param would bound this deterministically — **explicitly deferred** (server change, out of this delta's scope).
- **Regression risk from moving `logSession`.** *Mitigation:* the move is byte-for-byte (only `out`/`stream` indirection), and `log.test.ts` pins the observable contract. Existing `sse.test.ts`/`ops.test.ts` continue to cover the shared pieces.
- **Divergence from `runSession`'s message extraction.** *Mitigation:* `lastAssistantText` is a pure function mirroring `runSession`'s exact fallback order, unit-tested independently of the stream.
- **`al status --json` shape creep.** *Mitigation:* the JSON object is the raw `Session` record plus one added `lastMessage` key — no invented fields, so it can never drift from `GET /api/sessions/:id`.

## Answers to the Feature note's open questions

1. **Docs path.** Use the real path **`docs/knowledge/cli.md`** (`docs/reference/` does not exist). No new doc file; extend the existing reference[^cli-docs].
2. **`al log` without `--follow` semantics.** Keep the current behavior and document it precisely: without `--follow`, `al log` replays the history the server has *at the moment of the run* (the full sequenced snapshot), then stops when events go quiet for 500 ms, or immediately on `agent-done` for a stopped session. So for a stopped session it is the *complete* history; for a live session it is *history-up-to-now*. `--follow` keeps tailing live events. No semantics change in this delta — the promise "full event history" is stated as "full up to the run instant."
3. **`al status` last message.** Use the `runSession` fallback, as preferred: the text of the last completed assistant `message_end` via `messageText`, falling back to accumulated streamed `message_delta` text when `message_end` carries no usable message. A mid-turn session reports the *previous* completed turn's message (or `(none)` if there is none yet) — in-progress deltas are not reported until their `message_end` arrives. This is exactly `lastAssistantText`'s contract.
4. **`al status` output shape.** Human-readable lines by default **and** a `--json` variant, for parity with `al ls --json` / `al log --json` and for the dogfooding loop (agents script it). `--json` emits the raw `Session` record + `lastMessage`.
5. **Where the logic lives.** New **`lib/log.ts`** (moved `logSession`) and new **`lib/status.ts`** (`lastAssistantText`, `getSessionStatus`, `formatStatus`, `statusJson`); export `StreamFn` from `lib/ops.ts`. This mirrors the existing `runSession`/`watchSession` seam and keeps `agent-land.ts` to dispatch + `USAGE`.

## ADR pointers

No new ADR — this is CLI surface over existing primitives (Session record + Event Stream), and it directly extends ADR-014 (JSON as the canonical machine interface) with `al status --json` and the NDJSON `al log --json` contract[^adr-014]. The only architecture-adjacent decision (replaying the SSE stream client-side to recover the last message, rather than adding a server endpoint) is already the engine's existing observation model and needs no new ADR.

## Minimal change set

- `packages/cli/src/lib/log.ts` — new; `logSession` moved verbatim behind `out`/`stream`.
- `packages/cli/src/lib/status.ts` — new; `lastAssistantText`, `getSessionStatus`, `formatStatus`, `statusJson`, `StatusClient`, `SessionStatusResult`.
- `packages/cli/src/lib/ops.ts` — `export type StreamFn` (one line).
- `packages/cli/src/lib/args.ts` — add `"status"` to `COMMANDS` and `status: ["--json"]` to `COMMAND_FLAGS`.
- `packages/cli/src/agent-land.ts` — drop inline `logSession`, import from `lib/log.js`, add `status` dispatch + `USAGE` lines.
- `packages/cli/src/lib/log.test.ts` — new.
- `packages/cli/src/lib/status.test.ts` — new.
- `packages/cli/src/lib/args.test.ts` — extend with `status` parsing cases.
- `docs/knowledge/cli.md` — add `al status` + document `al log` no-`--follow` semantics.

Not touched: server, contracts, engine. The Feature note's acceptance criteria are satisfied by the above — `al log --json` NDJSON shape is locked by `log.test.ts`; `al status` prints status/mounts/connectors/last message and is covered by `status.test.ts`; both are documented in `docs/knowledge/cli.md`.

[^feature]: [CLI session observability Feature note](/product/features/cli-observability.md)
[^cli-entry]: `packages/cli/src/agent-land.ts`
[^api-client]: `packages/cli/src/lib/api.ts` — `getSession`, `eventsUrl`, `authHeader`
[^sse]: `packages/cli/src/lib/sse.ts` — `parseSseEvent` drops `: ping` and strips `data: `
[^ops]: `packages/cli/src/lib/ops.ts` — `runSession`/`watchSession` use `{ out, stream }` injection
[^render]: `packages/cli/src/lib/render.ts` — `messageText`
[^args]: `packages/cli/src/lib/args.ts`
[^session-contract]: `packages/contracts/src/session.ts`
[^event-contract]: `packages/contracts/src/event.ts`
[^events-route]: `packages/server/src/presentation/http/api-sessions.ts`
[^cli-docs]: [CLI (`al`)](/cli.md)
[^adr-014]: [ADR-014 — JSON API is the canonical machine interface](/adrs/014-json-api-canonical-machine-interface.md)
