---
okf_version: "0.2"
---

# Playbook

The agent-land playbook — the flagship way of working on top of the [platform](/platform/): its strategy, the system actually built from it, and the roadmap that got there.

* [Dogfooding](dogfooding.md) — the playbook itself: state a problem, review PRs at gates; inventory, operator model, phases, gaps, trust ladder
* [Multi-agent pipeline architecture](multi-agent-architecture.md) — the built system: intake, trigger, orchestrator session, stage children, gates, and the loopback primitive
* [Multi-agent workflow](multi-agent-workflow.md) — the roadmap from stated vision to review-ready PRs via orchestrated child sessions (Phases 0–4, all landed)
* [Ticket loop](ticket-loop.md) — the dogfooding heartbeat: one stateless prompt that advances every ticket by exactly one step per tick, fresh context per step (as-built in `loop.sh`)
