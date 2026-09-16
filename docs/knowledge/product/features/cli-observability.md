---
type: Feature
title: CLI session observability (al log --json, al status)
description: Trace a session end-to-end from the terminal — replay the raw event stream as newline-delimited JSON and print a session's settled state, bound mounts, connectors, and last assistant message.
status: draft
tags: [cli, observability, session]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-07T20:04:52Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
  - id: cli
    resource: /platform/cli.md
    title: CLI (`al`)
---

# CLI session observability

## Why

`al run` and `al new` produce sessions that outlive the terminal, but there is no way to look back at what happened — the event history and settled state are only visible by curling the SSE endpoint or reading the flat-JSON log on the host. The dogfooding loop needs the raw event record to debug stalls, wrong answers, and timeout causes[^dogfooding].

## User stories

- As an operator, I want `al log <id> --json` to print the event stream as one JSON object per line, so I can pipe it through `jq`.
- As an operator, I want `al status <id>` to print status, mounts, connectors, and the last assistant message, so I see where a detached session stands without replaying the whole log.
- As an agent (dogfooding itself), I want the observability surface to be scriptable from the CLI, so a session can watch its own children via the Platform Connector.

## Acceptance criteria

- `al log <id> --json` prints one JSON object per line — SSE frames stripped of `data:`, `agent-done` and ping frames suppressed, no duplicate `seq`s.
- `al status <id>` prints: status, bound mounts, connectors, and the last assistant `message_end` text. (`al status` is new; `al log` semantics already exist and need test locking.)
- Both commands are covered by CLI tests and documented in `docs/knowledge/platform/cli.md`.

## Open questions

- **`al log` without `--follow`.** Full-history-and-exit, or snapshot-to-now? The acceptance-criterion promises shape only.
- **`al status` last message.** Final `message_end` text, or the `runSession` fallback (`message_delta` + `message_end`)?
- **Output shape.** Human-readable only, or `--json` parity with `al log --json`?
- **Code home.** New `lib/status.ts` vs. extending `lib/ops.ts`.

[^engine]: [Agent Land engine](/platform/engine.md)
[^dogfooding]: [Dogfooding strategy](/playbook/dogfooding.md)
[^cli]: [CLI (`al`)](/platform/cli.md)