# Agent Land — Architecture

How a session flows through the refactored system. `core/` owns domain state, `infra/` implements ports, `presentation/` exposes the core over HTTP + SSE.

## Entities & relationships

```mermaid
flowchart LR
    SS[SessionService] -->|owns| A["AgentSession<br/>id · status · permissionPolicy"]
    A -->|driven by| AH[AgentHandle]
    A -->|emits| E["SessionEvent<br/>type"]
    A -->|uses| C["Connector<br/>name · type"]
    C -->|points to| SF["SecretFile<br/>filename"]
    HR[AgentHarness] -->|starts| AH
```

- **`AgentSession`** — the single entity; one-shot = a session with `permissionPolicy: "auto"`.
- **`AgentHandle`** — live handle to the running pi process (prompt/respond/abort/stop).
- **`SessionEvent`** — canonical event stream consumed by SSE/HTML.
- **`Connector`** — pointer to an encrypted `SecretFile` (SOPS/Age), decrypted only at launch.
- **`SecretFile`** — SOPS/Age-encrypted credentials file mounted as env vars in the container.
- **`AgentHarness`** — port that spawns the handle; `PiRpcHarness` speaks JSONL to `pi --mode rpc`.
- **`SessionService`** — the single control surface: state machine, policy, and event fan-out.

## System architecture

```mermaid
flowchart LR
    subgraph Client
        B[Browser<br/>HTMX + SSE]
        C[curl / API client]
        AL[al CLI<br/>REST + SSE]
    end

    subgraph Orchestrator [Node/Express server]
        P[presentation/http<br/>api-sessions REST+SSE]
        PC[presentation/http<br/>api-connectors]
        PM[presentation/http<br/>api-models]
        R[routes/*<br/>EJS pages]
        SS[core/SessionService<br/>state machine + policy]
        CS[core/ConnectorService]
        H["infra/PiRpcHarness<br/>rpc → canonical events"]
        D[infra/DockerService]
        SO[infra/SopsService]
        RP[infra/repositories<br/>JSON files]
        PV[infra/providers<br/>model catalog]
    end

    subgraph Host
        Docker["containers<br/>agent-land-pi-&lt;id&gt;"]
        F[data/sessions/*.json]
        SE[secrets/*.yaml<br/>SOPS/Age]
    end

    B --> R
    C --> P
    AL --> P
    AL --> PC
    AL --> PM
    P --> SS
    PC --> CS
    PM --> PV
    R --> SS
    SS --> H
    SS --> CS
    SS --> D
    SS --> SO
    SS --> RP
    H --> D
    CS --> RP
    CS --> SO
    D --> Docker
    RP --> F
    SO --> SE
    Docker -- "JSONL over stdin/stdout" --> H
```

## Life of a session

```mermaid
sequenceDiagram
    participant U as User (browser/curl)
    participant A as SessionService
    participant D as Docker
    participant P as PiRpcHarness
    participant C as pi (--mode rpc in container)

    U->>A: POST /api/sessions {connectors, policy}
    A->>A: resolveAgentEnv (decrypt SOPS secrets)
    A->>D: ensureAgentImage + createInteractiveContainer
    A->>D: container = sleep infinity (agent-land-pi-<id>)
    A->>A: persist AgentSession (status=idle)
    A->>P: harness.start(session)
    P->>D: exec pi --mode rpc (raw JSONL)
    D-->>P: exec duplex stream

    U->>A: POST /:id/prompt {message}
    A->>P: {"type":"prompt",...} → stdin
    A->>A: status=running

    C-->>P: agent_start / message_update / tool_* / ...
    P-->>A: canonical SessionEvents (mapped + demuxed)
    A-->>U: SSE stream (status, message_delta, message_end, tool_*)

    C-->>P: extension_ui_request (confirm/input/select)
    P-->>A: waiting_for_input

    alt permissionPolicy = auto
        A->>P: extension_ui_response (auto-answer)
    else manual
        A->>A: status=waiting_for_input
        U->>A: POST /:id/respond
        A->>P: extension_ui_response
        A->>A: status=running
    end

    C-->>P: agent_settled
    P-->>A: agent_settled
    A->>A: status=idle

    U->>A: DELETE /:id
    A->>P: abort + stop
    A->>D: removeContainer
    A->>A: status=stopped
```

## State machine

```mermaid
stateDiagram-v2
    [*] --> idle : create session
    idle --> running : prompt()
    running --> idle : agent_settled
    running --> waiting_for_input : extension_ui_request (manual)
    waiting_for_input --> running : respond()
    running --> stopped : kill() / stream close
    idle --> stopped : kill() / stream close
    stopped --> [*]
```
