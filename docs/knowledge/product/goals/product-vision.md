---
type: ProductGoal
title: Agent Land product vision
description: The vim of agentic platforms — an easy-to-deploy engine that runs isolated agent sessions on your own server, plus playbooks on top that encode proven ways of working.
status: draft
generated: { by: opencode/qwen3.8-max, at: 2026-09-13T00:00:00Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: strip-adr
    resource: /adrs/016-strip-web-ui-and-vendor-knowledge.md
    title: Strip Web UI and Vendor Knowledge from Server
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
---

# Agent Land product vision

**One-liner:** Agent Land is the vim of agentic platforms: easy to deploy, driven from any terminal, honest down to its plain-text state. The engine runs isolated agent sessions on your own server — securely, durably, unattended. **The engine runs agents; playbooks decide how.**

## Why it exists

Personal, local-first agent tools are powerful but live in a laptop terminal — a long task dies with the tmux session, a multi-hour run means keeping a pane awake, and a train ride with no signal means babysitting nothing. Rented cloud agents flip the problem: they keep running, but they aren't yours — their hardware, their queues, their rules. Agent Land keeps the spirit — mine, controlled, private — and moves the work onto your server:

- agents keep working after you close the laptop,
- you look in from anywhere, on any connection — the live feed replays what you missed,
- secrets stay encrypted until the moment an agent needs them,
- it deploys in minutes — one container, Docker, flat JSON files; no database, no cluster,
- and the things you do repeatedly become recipes that eventually run on their own.

## The two layers

**The engine is the product. Everything above it is your opinion.**

The engine is neutral machinery. It runs agents as isolated sessions in containers, gives each one sealed credentials, a model, and a workspace, observes everything through a single event feed, and lets agents hire agents. Its contract is the isolated session plus that event feed — the runtime inside the session is an opinionated choice, with pi as the reference implementation. The technical decomposition (six primitives, three substrates) lives in the [engine note](/platform/engine.md)[^engine].

How you use it lives in **playbooks** — bundles of skills, recipes, policies, and gates that encode proven ways of solving hard problems with agentic workflows. Playbooks are composition: they speak the same JSON/SSE API as every other client, and they are swappable — the engine never grows workflow knowledge[^strip-adr]. They are first-class citizens of the monorepo, bundled as packages, not scattered config. The first playbook is agent-land's own: the [dogfooding playbook](/playbook/dogfooding.md), where you state a problem, review PRs at gates, and everything in between runs itself.

Three words, one chain: a **workflow** is the pattern of orchestrated work; a **recipe** defines one concretely — the control flow that creates, prompts, watches, and reacts to sessions; a **playbook** bundles recipes with skills, policies, gates, and artifacts into a way of working. Platform notes speak only of workflows and composition; recipes and playbooks are defined here and live in the playbook shelf.

```mermaid
graph TB
    subgraph comp["PLAYBOOKS — how you use it (your opinion, swappable)"]
        dogfood["the agent-land playbook (dogfooding)<br/>pipeline · HITD recipe · OKF memory · gates · clients"]:::flag
        any["…any other way of working"]:::dim
    end
    subgraph core["THE ENGINE — the product (neutral machinery)"]
        run["Run agents securely & durably<br/>(isolated sessions in containers)"]:::core
        cap["Give them capabilities<br/>(sealed connectors · providers · mounts)"]:::core
        obs["Observe everything, interpret nothing<br/>(one event stream)"]:::core
        loop["Let agents compose agents<br/>(platform loopback)"]:::core
    end
    subgraph sub["SUBSTRATE"]
        infra["Docker · SOPS/Age · flat JSON"]:::substrate
    end
    comp -->|"JSON/SSE API only"| core --> sub

    classDef core fill:#1b5e20,stroke:#4caf50,color:#e8f5e9
    classDef substrate fill:#37474f,stroke:#90a4ae,color:#eceff1
    classDef flag fill:#e65100,stroke:#ff9800,color:#fff3e0
    classDef dim fill:#455a64,stroke:#90a4ae,color:#cfd8dc
```

### The vim test

The analogy is a commitment, not branding — five properties every change must preserve:

| Property | Commitment |
|---|---|
| Deploys in minutes, runs anywhere | one container + Docker + flat JSON — no database, no cluster |
| Terminal-native, scriptable | CLI + JSON/SSE API; any UI is an external consumer |
| Works on a bad connection | state lives server-side; clients re-attach and replay |
| Plain text all the way down | flat-JSON records, event logs, OKF notes |
| Stable minimal core, extensions outside it | the engine is isolated sessions; playbooks are the extensions |

## Value

1. **Durability** — sessions outlive the laptop; start Friday, look Monday.
2. **Control & privacy** — your infrastructure, your keys; agents get scoped, sealed credentials.
3. **Autonomy with trust** — agents run unattended but stop and ask when it matters, instead of guessing.
4. **Anything can work here** — the same engine prepares your day (fetch emails and notes into a morning brief) and builds the complex feature in your codebase. Connectors define reach; playbooks define method.
5. **Your way of working, encoded** — playbooks turn habits into skills, recipes, and gates.
6. **API-first** — everything the CLI does is a `curl` away; humans, crons, and agents are peer clients[^strip-adr].

## Principles

- **Mine.** Self-hosted; the only external dependency is the LLM provider.
- **Small and deployable.** One person, one sitting; the vim test above is the regression suite.
- **Secrets stay sealed.** Encrypted at rest; decrypted in-memory, only at launch, only for what a session needs.
- **The engine runs agents; playbooks decide how.** Workflows, orchestration, and vendor knowledge stay outside the engine[^strip-adr].
- **Ask when it matters.** Human-in-the-loop is a designed state, not an interruption.
- **API-first.** No vendor catalog, no web UI in-core — presentation and preset knowledge live in clients and playbooks[^strip-adr].

[^strip-adr]: [Strip Web UI and Vendor Knowledge from Server](/adrs/016-strip-web-ui-and-vendor-knowledge.md)
[^engine]: [Agent Land engine](/platform/engine.md)
