---
status: accepted
date: 2026-07-31
tags: [architecture, agents, safety, kill-switch]
deciders: [marcoklein]
---

# Per-Run Kill-Switch with Incremental Token and Cost Tracking

**Decision:** Each agent run carries its own `KillSwitch` (timeout, maxTokens, maxCost) specified at launch, not as global server config. Limits are enforced mid-execution by parsing pi's `message_end` events for incremental `usage.totalTokens` and `usage.cost.total`. Defaults: 1 hour, 100k tokens, $1. Any limit set to `null` disables that check.

**Why:** Per-run limits match the user's mental model — different tasks have different risk tolerances. Global env vars would apply the same cap to all runs. Incremental tracking via pi's existing JSON events avoids an external proxy or API polling layer. A manual kill route (`POST /agents/:id/kill`) provides a human override.

**How it works:**
- `AgentRunner.launch()` accepts `killSwitch?: Partial<KillSwitch>`, merged with `DEFAULT_KILL_SWITCH`
- A `setTimeout` watchdog handles the time-based kill
- A `LogCallback` attached to `streamLogs` parses each line for `message_end` events where `message.role === "assistant"` and extracts `message.usage.totalTokens` + `message.usage.cost.total`
- Cumulative tokens and cost are compared against limits after each event
- `AgentRunner.kill()` is idempotent (uses a `Set`), sets `run.status = "killed"` synchronously before `await stopContainer()` to prevent a race with the exit handler

**Limits:** Token/cost tracking depends on pi emitting `usage` in assistant `message_end` events. If pi stops doing this, threshold-based kills silently stop working (time-based kill still works). Cost tracking relies on the LLM provider returning per-message cost data through pi's provider layer.

**Alternatives considered:** Global env vars (`AGENT_MAX_TOKENS`, `AGENT_TIMEOUT_SECONDS`) — rejected because different tasks need different limits. Provider-side budget caps (OpenCode API limits) — would work but depends on provider support and isn't visible to the user in the UI. Docker container timeout (`docker run --stop-timeout`) — only handles time, not tokens/cost, and Docker would lose the structured kill reason.
