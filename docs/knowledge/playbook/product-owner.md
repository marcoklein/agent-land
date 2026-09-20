---
type: Strategy
title: Product owner — the intake touchpoint
description: How the operator feeds the ticket loop: start a product-owner agent to turn outcomes into loop-ready tickets, run the loop on the host, and review only at the two gates.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-20T00:00:00Z }
sources:
  - id: ticket-loop
    resource: /playbook/ticket-loop.md
    title: Ticket loop — the dogfooding heartbeat
  - id: ticket-layer
    resource: /product/designs/ticket-layer-design.md
    title: Ticket layer — agent-land-tickets
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
---

# Product owner — the intake touchpoint

The operator's day is two moments: **intake** and **gate review**. Intake used to mean running `tk create` by hand. Now it is a **product-owner agent** — a session you start, tell your outcomes, and it writes the tickets. The loop does the rest.

```mermaid
flowchart LR
    H(["You — state an outcome"]):::human --> PO["product-owner agent<br/>intake · split · dep · tag loop"]:::playbook
    PO --> T[("agent-land-tickets<br/>.tickets/ · work/")]:::store
    T --> LOOP["host loop<br/>loop.sh · systemd timer"]:::playbook
    LOOP --> A["phase agent<br/>one tick · one phase"]:::engine
    A -->|"artifacts + STATUS"| T
    A -.->|"design / merge"| G{"gates — you review"}:::human
    G -.->|unpark| T

    classDef human fill:#e65100,stroke:#ff9800,color:#fff3e0
    classDef playbook fill:#4a2c88,stroke:#8e6fd1,color:#f0e8ff
    classDef engine fill:#1b5e20,stroke:#4caf50,color:#e8f5e9
    classDef store fill:#37474f,stroke:#90a4ae,color:#eceff1
```

## Start the product-owner agent

The `product-owner` skill is baked into the agent image, so **one persistent session is your whole intake**. Start it once, then chat over many turns:

```bash
al new                          # pick provider/model, and the GitHub connector ("GitHub Personal All Repos"), then:
#   you> you are the product owner
#   you> here are my outcomes: add a health-check endpoint; make "al board" group by phase
```

Each turn the agent refines whatever you give it into loop-ready tickets — `tk create` with `loop,needs-refinement`, splits epics, wires deps — and pushes them to `agent-land-tickets`. It reports the ticket ids back. The loop then advances them phase by phase; you only re-enter at the two gates.

One-shot (no chat): `al run "you are the product owner: …" --connectors "GitHub Personal All Repos"`.

## The loop runs on the host

`scripts/loop.sh` runs unattended on the server as a systemd timer, not on your laptop — see `deploy/` in `agent-land-tickets` for the units and setup. One tick every few minutes: pull, pick the next ready `loop` ticket, spawn one fresh agent, retag the phase.

## Your two touchpoints

1. **Intake** — state outcomes to the product-owner agent (or drop a ticket directly: `tk create … --tags "loop,needs-refinement"`).
2. **Gate review** — approve at design (PR on the OKF note) and merge (implementation PR). The loop parks at both as `human`; you unpark by removing the tag.

Everything between is the platform's job. Tickets are the only state you touch.

[^ticket-loop]: [Ticket loop](/playbook/ticket-loop.md)
[^ticket-layer]: [Ticket layer](/product/designs/ticket-layer-design.md)
