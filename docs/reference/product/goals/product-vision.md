---
type: ProductGoal
title: Agent Land product vision
description: Agent Land is a self-hosted home for long-lived AI coding agents — durable sessions, sealed secrets, and orchestratable workflows, driven from the CLI and a JSON/SSE API.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: engine
    resource: /reference/engine.md
    title: Agent Land engine — the purest form
  - id: strip-adr
    resource: /adrs/016-strip-web-ui-and-vendor-knowledge.md
    title: Strip Web UI and Vendor Knowledge from Server
---

# Agent Land product vision

**One-liner:** Agent Land is a self-hosted home for AI coding agents — long-lived sessions on my server, encrypted secrets, and orchestratable workflows, driven from the CLI and reachable through a JSON/SSE API.

## Why it exists

Personal, local-first agent tools are powerful but live in a laptop terminal — a long task dies with the tmux session, a multi-hour run means keeping a pane awake, and recurring chores need remembering. Agent Land keeps the spirit — mine, controlled, private — but moves the work onto the server:

- sessions persist independently of the laptop,
- the CLI (`al`) is the primary interface; the server is a pure JSON/SSE API (no web UI)[^strip-adr],
- secrets are encrypted at rest (SOPS/Age) and decrypted only at launch,
- the things I do repeatedly become recipes and, eventually, schedules.

## Value

1. **Durability** — start Friday, look Monday; sessions outlive the laptop.
2. **Control & privacy** — my infrastructure, my keys; connectors hand agents scoped, sealed credentials.
3. **Autonomy with trust** — agents run unattended, but pause and ask when it matters (approval gates, mid-run steering).
4. **Reusable working patterns** — connectors, skills, and roles encode how I work once; recipes compose them.
5. **API-first** — everything the CLI does is also a `curl` away over the JSON/SSE API.

## The six primitives

The engine is six primitives, three substrates, one opinion — everything else is composition[^engine]:

- **Connector** — named sealed env bag (SOPS/Age), generic, no type enum.
- **Provider** — LLM backend config as a generic record, no vendor catalog in-core.
- **Mount** — named durable folder attached to a session *(roadmap)*.
- **Session** — one `pi --mode rpc` agent in one container, with a permission policy.
- **Event Stream** — the single sequenced observation channel over SSE.
- **Platform Connector** — self-injected `AGENT_LAND_URL`/`AGENT_LAND_BASIC_AUTH` so an agent can spawn children *(roadmap)*.

## Principles

- **Mine.** Self-hosted; the only external dependency is the LLM provider.
- **Secrets stay sealed.** Encrypted at rest; decrypted in-memory, only at launch, only for the connectors a session needs.
- **Sessions first.** Orchestration composes sessions — it doesn't replace them.
- **Ask when it matters.** Human-in-the-loop is a designed state, not an interruption.
- **API-first.** No vendor catalog, no web UI in-core — presentation and preset knowledge live in the CLI[^strip-adr].

[^strip-adr]: [Strip Web UI and Vendor Knowledge from Server](/adrs/016-strip-web-ui-and-vendor-knowledge.md)
[^engine]: [Agent Land engine](/reference/engine.md)
