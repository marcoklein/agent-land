---
status: accepted
date: 2026-07-31
tags: [agents, safety]
deciders: [marcoklein]
---

# Per-Run Kill-Switch with Incremental Token and Cost Tracking

**Decision:** Each agent run carries its own `KillSwitch` (timeout, maxTokens, maxCost) specified at launch; limits are enforced by parsing pi's `message_end` events for cumulative tokens and cost. Defaults: 1 hour, 100k tokens, $1. A manual kill route provides human override.

**Why:** Per-run limits match the risk per task; incremental tracking via pi's existing JSON events avoids a proxy or polling layer. Token/cost kills depend on pi emitting `usage` in `message_end` events — if it stops, threshold kills stop working (timeout survives).

**Alternatives considered:** Global env vars — rejected: different tasks need different limits. Provider-side caps — rejected: varies by provider, not visible to the operator. Docker timeout — rejected: handles time only.