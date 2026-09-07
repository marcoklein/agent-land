---
type: Feature
title: CLI session observability (al log --json, al status)
description: Trace a session end-to-end from the terminal — replay the raw event stream as newline-delimited JSON and print a session's settled state, bound mounts, connectors, and last assistant message.
status: draft
tags: [cli, observability, event-stream, session, dogfooding]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-07T20:04:52Z }
sources:
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the purest form
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: vision-board
    resource: /product/goals/vision-board.md
    title: Product vision board
  - id: dogfooding
    resource: /dogfooding.md
    title: Dogfooding — developing agent-land on agent-land
  - id: cli
    resource: /cli.md
    title: CLI (`al`)
  - id: cli-entry
    resource: packages/cli/src/agent-land.ts
    title: `al` entrypoint — logSession and command dispatch
  - id: sse-lib
    resource: packages/cli/src/lib/sse.ts
    title: SSE parsing and streaming
  - id: ops-lib
    resource: packages/cli/src/lib/ops.ts
    title: runSession / watchSession / createSeqFilter
  - id: events-route
    resource: packages/server/src/presentation/http/api-sessions.ts
    title: Session API — GET /api/sessions/:id/events (SSE replay + live)
  - id: session-contract
    resource: packages/contracts/src/session.ts
    title: Session record schema (status, connectors, mounts, model, provider)
  - id: event-contract
    resource: packages/contracts/src/event.ts
    title: Session event schema (message_end, agent_settled, …)
---

# CLI session observability

Fit-check (refine stage, before writing this note):

- **Boundary** — in scope. Both commands are pure CLI surface reading the two things the engine already exposes: the [Session](/engine.md#the-engine) record (`GET /api/sessions/:id`, incl. `status`, `connectors`, bound `mounts`) and the append-only [Event Stream](/engine.md#observation) (`GET /api/sessions/:id/events`, SSE replay + live). No new or changed primitive; no UI in-core, no orchestration, no vendor knowledge[^boundary].
- **Vision board** — worth building. It serves the *API-first* and *autonomy with trust* needs: the operator can trace what a session actually did, not just its final status. It directly supports the dogfooding loop — "run → observe → diagnose" — which is the platform's own success signal (task → green-PR time, red-CI self-recovery)[^dogfooding][^vision-board].

No scope deviation.

## Why

`al run`, `al new`, and `al chat` produce sessions that run long after the terminal detaches, but there is no way to look back at *what happened* from the terminal: the full event history and the session's settled state are only visible by curling the SSE endpoint or reading the flat-JSON log on the host. That makes the dogfooding loop — where agent-land runs against agent-land — hard to debug: when a run stalls, times out, or settles with the wrong answer, the operator needs the raw event record and a one-line summary of the final state to see where it went[^dogfooding].

## User stories

- As an operator, I want `al log <id> --json` to print the raw event stream as one JSON object per line, so I can pipe it into `jq`, grep, or a script and reason about the run mechanically.
- As an operator, I want `al status <id>` to print a session's status, bound mounts, connectors, and last assistant message, so I can see where a detached session stands without replaying the whole log.
- As an agent (dogfooding itself), I want the observability surface to be scriptable from the CLI, so a session can watch its own children end-to-end via the [Platform Connector](/product/features/platform-connector.md) and the [Event Stream](/engine.md#observation).

## Acceptance criteria

- `al log <id> --json` prints one JSON object per line — the SSE frames stripped of the `data: ` prefix, `agent-done` and `: ping` frames suppressed, no duplicate `seq`s.
- `al status <id>` prints: status, bound mounts (name → container path), connectors, and the text of the last assistant `message_end`.
- Both commands are covered by CLI tests (`packages/cli/src/lib/*.test.ts`, vitest) and documented in `docs/knowledge/cli.md`.

## Verified current state (the real delta)

Checked against `main` at `eaf26af`:

- **`al log <id> [--follow] [--json]` already exists.** `logSession` in `packages/cli/src/agent-land.ts` streams via `streamSse` (`lib/sse.ts`), `JSON.parse`s each frame's `data`, dedupes by `seq`, and — when `--json` — writes `JSON.stringify(parsed) + "\n"`[^cli-entry][^sse-lib]. That is already newline-delimited JSON with the `data: ` prefix stripped, and `agent-done` is checked *before* data parsing (never printed) while `: ping` comments are dropped by `parseSseEvent`. The first acceptance criterion is therefore **already satisfied** by the current implementation; the delta here is to *lock the semantics with tests* (there is currently no test asserting the `--json` output shape) and to fix any drift found.
- **`al status` does not exist.** It is absent from the `COMMANDS` set in `lib/args.ts`, from the `USAGE` block, and from `docs/knowledge/cli.md`. This is the additive part: a new command that reads the session record plus the replayed event log.
- **No server change is needed.** `GET /api/sessions/:id` returns `status`, `connectors`, `mounts` (bound `{source, target}`), `model`, `provider`, timestamps; the last assistant message is recoverable by replaying the SSE stream and taking the final `message_end`, whose text is extracted by the existing `messageText` helper in `lib/render.ts`[^session-contract][^event-contract][^events-route]. The implementation likely extracts a testable `sessionStatus`/`logJson` helper into `lib/` (mirroring `runSession`/`watchSession` in `ops.ts`) so it can be driven with an injected fake stream.

## Open questions

- **Docs path.** The issue says "documented in `docs/reference/cli.md`" but the CLI docs actually live at `docs/knowledge/cli.md` (`docs/reference/` does not exist). Use the real path `docs/knowledge/cli.md`; confirm this with the design gate[^cli].
- **`al log` without `--follow` semantics.** The current `logSession` applies a 500 ms "quiet stop" once events stop, so for a *running* session it yields a snapshot up to "now" rather than the full history-then-exit; a *stopped* session replays fully and ends on `agent-done`. Should `al log` (no `--follow`) mean "replay full history and exit", or is snapshot-to-now acceptable? The `--json` acceptance criterion is shape-only, but this decides what "full event history" promises.
- **`al status` last message.** Is the last assistant message the final `message_end` text, the final rendered turn text (streaming `message_delta` + `message_end` fallback, as `runSession` does), or empty when the session is mid-turn? Prefer the `runSession` fallback for consistency.
- **Output shape for `al status`.** Human-readable lines vs. a `--json` variant. The outcome specifies human-readable; add `--json` only if the design gate wants parity with `al ls --json` / `al log --json`.
- **Where the logic lives.** New `lib/status.ts` vs. extending `lib/ops.ts` — the design gate should pick the minimal testable seam.

[^engine]: [Agent Land engine](/engine.md)
[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md)
[^vision-board]: [Product vision board](/product/goals/vision-board.md)
[^dogfooding]: [Dogfooding — developing agent-land on agent-land](/dogfooding.md)
[^cli]: [CLI (`al`)](/cli.md)
[^cli-entry]: `packages/cli/src/agent-land.ts`
[^sse-lib]: `packages/cli/src/lib/sse.ts`
[^ops-lib]: `packages/cli/src/lib/ops.ts`
[^events-route]: `packages/server/src/presentation/http/api-sessions.ts`
[^session-contract]: `packages/contracts/src/session.ts`
[^event-contract]: `packages/contracts/src/event.ts`
