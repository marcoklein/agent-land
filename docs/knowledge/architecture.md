---
type: Reference
title: Agent Land architecture — the zoom ladder
description: The six primitives and three substrates, shown as a ladder of diagrams from one turn up to the deployed platform.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: engine
    resource: /knowledge/engine.md
    title: Agent Land engine — the purest form
---

# Agent Land architecture — the zoom ladder

The same system at six scales. Everything here is a projection of the [engine](/knowledge/engine.md) — six primitives, three substrates, one opinion.

## Zoom in — one turn, concretely

```mermaid
sequenceDiagram
    autonumber
    participant You
    participant CLI as al CLI
    participant API as JSON/SSE API
    participant SS as Session engine
    participant SOPS as SOPS/Age
    participant DK as Docker
    participant PI as pi agent

    You->>CLI: al run fix-the-typo --rm
    CLI->>API: POST /api/sessions {connectors, model}
    API->>SS: createSession
    SS->>SOPS: decrypt connector secrets
    SOPS-->>SS: env vars (in-memory)
    SS->>DK: create container + volumes
    DK-->>SS: container id
    SS->>PI: exec pi --mode rpc
    API-->>CLI: { session }
    CLI->>API: POST /api/sessions/:id/prompt
    API->>PI: RPC prompt
    loop the turn
        PI-->>API: events (turn_start, message_delta, tool_…)
        API-->>CLI: SSE stream
    end
    PI-->>API: agent_settled
    CLI->>You: final answer
    CLI->>API: DELETE /api/sessions/:id
```

Secrets are decrypted in-memory at launch and injected as container env vars — they never touch disk or the API.

## The atom — a session's lifecycle

```mermaid
stateDiagram-v2
    [*] --> idle : create
    idle --> running : prompt
    running --> waiting_for_input : dialog
    waiting_for_input --> running : respond
    running --> idle : settled
    idle --> stopped : kill
    running --> stopped : kill
    waiting_for_input --> stopped : kill
    stopped --> [*]
```

The session is the atom of the platform — one `pi` agent in one container. Long-lived, re-attachable, durable across orchestrator restarts.

## The system — one diagram

```mermaid
graph LR
    subgraph usecase["USE-CASE LAYER — recipes"]
        direction TB
        workflow["Workflow<br/>scripts"]:::outside
        project["Project<br/>mount + recipe"]:::outside
        pack["Connector pack<br/>schema + skills"]:::outside
        preset["Provider preset<br/>endpoint + models"]:::outside
    end

    subgraph engine["THE ENGINE"]
        direction LR
        connector["Connector<br/>sealed env bag"]:::core
        provider["Provider<br/>LLM backend record"]:::core
        mount["Mount<br/>durable volume (roadmap)"]:::core
        session["Session<br/>pi agent in Docker"]:::core
        events["Event Stream<br/>sequenced SSE"]:::core
    end

    subgraph substrate["SUBSTRATE"]
        direction TB
        docker["Docker"]:::substrate
        sops["SOPS/Age"]:::substrate
        json["Flat JSON"]:::substrate
    end

    connector -->|"env vars at launch"| session
    provider  -->|"model + key at launch"| session
    mount     -->|"workspace at launch"| session
    session   -->|"produces"| events

    events    -->|"watch"| workflow
    workflow  -->|"create"| session

    pack      -->|"informs"| connector
    preset    -->|"informs"| provider
    project   -->|"uses"| mount

    docker -.->|"hosts"| session
    docker -.->|"hosts"| mount
    sops   -.->|"seals"| connector
    sops   -.->|"seals"| provider
    json   -.->|"persists"| session
    json   -.->|"persists"| events
    json   -.->|"persists"| connector
    json   -.->|"persists"| provider

    classDef core fill:#1b5e20,stroke:#4caf50,color:#e8f5e9
    classDef substrate fill:#37474f,stroke:#90a4ae,color:#eceff1
    classDef outside fill:#e65100,stroke:#ff9800,color:#fff3e0
```

Capabilities are injected at launch · sessions produce event streams · recipes watch streams and create sessions · substrate hosts, seals, and persists.

## Zoom out — the composition loop

```mermaid
graph LR
    subgraph parent["Orchestrator session"]
        main["Agent A<br/>plans + reviews"]:::core
    end

    api["Platform API"]:::core

    subgraph children["Child sessions"]
        planner["Agent B<br/>planner"]:::core
        coder["Agent C<br/>coder"]:::core
        reviewer["Agent D<br/>reviewer"]:::core
    end

    main    -->|"POST /api/sessions"| api
    api     --> planner
    api     --> coder
    api     --> reviewer
    planner -->|"SSE events"| api
    coder   -->|"SSE events"| api
    reviewer -->|"SSE events"| api
    api     -->|"watch streams"| main
```

Orchestration lives in the feedback loop, outside the engine. A workflow is a script that creates sessions, prompts them, watches their event streams, and reacts. Agent-driven looping (agents spawning agents) arrives with the Platform Connector; today the loop is driven externally via the CLI and the API.

## Zoom out — the platform on a server

```mermaid
graph TB
    subgraph clients["CLIENTS"]
        direction LR
        laptop["al CLI — anywhere"]:::outside
        cron["Cron · CI · scripts"]:::outside
    end

    subgraph server["YOUR SERVER"]
        direction TB
        nginx["nginx<br/>SSL + basic auth"]:::outside
        orch["Orchestrator<br/>JSON/SSE API"]:::core
        data[("volumes<br/>data/ · secrets/")]:::substrate
        dk["Docker daemon"]:::substrate
        subgraph agents["Agent containers (siblings)"]
            direction LR
            s1["agent-land-pi-…"]:::core
            s2["agent-land-pi-…"]:::core
        end
    end

    laptop --> nginx
    cron --> nginx
    nginx --> orch
    orch -->|"flat JSON + SOPS"| data
    orch -->|"docker socket"| dk
    dk --> agents
```

Production is a `git push dokku main:master` that builds the Dockerfile and provisions SSL + nginx basic auth; local dev is `docker compose up --build -d`.

## Design invariants

1. **Registries outlive sessions.** Connectors, providers, mounts are catalogs; sessions reference but never mutate them.
2. **Create-time is resolution-time.** Env, engine config, and mounts are fixed when the session starts.
3. **The platform observes.** The event stream is the only observation channel; its vocabulary is agent-mechanical.
4. **Vendor knowledge and workflows stay in the composition layer.** Presets, packs, projects, workflows — recipes that build on the primitives.
