---
status: accepted
date: 2026-07-27
tags: [agent, cli]
deciders: [marcoklein]
---

# Pi Headless via --mode json --print

**Decision:** Run pi as `pi --mode json --print --provider opencode-go` for headless operation.

**Why:** JSONL output on stdout is machine-parseable. `--print` runs non-interactively and exits after completion. The orchestrator streams and renders the JSON events as HTML fragments.

**Alternatives considered:** pi TUI mode, direct LLM API calls — rejected because TUI requires a terminal; direct API calls would bypass pi's tool execution, session management, and skill system.
