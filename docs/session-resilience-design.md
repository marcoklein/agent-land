# Session Resilience Across Redeploys — Design

What happens when the orchestrator (the Dokku web container) is redeployed while agent sessions are still running, and how sessions recover their state.

## The question, answered

Three questions drive this design:

- **Is the agent's Docker container killed on redeploy?** No. Agent containers are *sibling* containers created directly on the host Docker daemon through the mounted socket (`adrs/002`). Dokku only manages the app's own `agent-land.web.1` container. On deploy, the old web container receives SIGTERM after the new one is up — observed on the server as `agent-land.web.1.1786886446` `Exited (143)`. Agent containers (`agent-land-pi-<id>`, entrypoint `sleep infinity`) are never touched.
- **Does the agent keep working?** No. The `pi --mode rpc` process lives inside the agent container but its stdin/stdout is a hijacked `docker exec` stream owned by the old web process (`PiRpcHarness.start`). When the web process dies, the socket closes, the exec stream gets EOF, and pi exits gracefully. Verified empirically: a leftover smoke-test container was still `running` with only `/bin/sleep infinity` — the pi exec was gone.
- **Can we "save" state?** Yes — most state is *already* saved. What is lost is the live harness handle, the in-memory event history, and the SSE subscriptions. Because `SessionService.handles` is in-memory only, the new web process cannot prompt pre-redeploy sessions today (`SessionNotFoundError`: "Session is not running").

## What happens today

```mermaid
sequenceDiagram
    participant CI as GitHub Actions
    participant D as Dokku
    participant W1 as web.1 (old)
    participant W2 as web.1 (new)
    participant H as Host Docker daemon
    participant A as agent-land-pi-&lt;id&gt;

    CI->>D: git push dokku main:master
    D->>W2: start new container (socket mounted)
    Note over D: checks pass / retire old
    D->>W1: SIGTERM (30s grace, then SIGKILL)
    W1--xA: exec stream closes (EOF)
    A->>A: pi exits gracefully
    Note over A: container stays running (sleep infinity)
```

After redeploy, the state is inconsistent:

- The agent container runs, the pi conversation (`/sessions/<id>/*.jsonl`), the workspace volume, and the JSON session record all survive.
- The session record's `status` is stale (e.g. `running` or `waiting_for_input` forever — nothing updates it anymore).
- `GET /api/sessions` lists the session; `POST /:id/prompt` answers 404 "not running"; SSE reconnects with empty history.

## Persistence matrix

| Layer | Survives redeploy? | Why |
|-------|--------------------|-----|
| Agent container (`agent-land-pi-<id>`) | Yes | Sibling on host daemon; Dokku never manages it |
| pi RPC process | No (exits) | Its stdio is an exec stream owned by the dying web process |
| pi session transcript (`/sessions/<id>/*.jsonl`) | Yes | Shared named volume `agent-land-sessions` |
| Workspace (`agent-land-ws-<id>` at `/workspace`) | Yes | Per-session named volume, kept on `kill()` by design |
| `AgentSession` JSON record (`data/sessions/<id>.json`) | Yes | Dokku storage mount `/app/data` |
| Harness handle (prompt/respond/abort) | No | `SessionService.handles` is in-memory |
| Event history (SSE transcript) | No | In-memory ring buffer (`HISTORY_CAP`) |
| Status accuracy | No | Stale; nothing emits events anymore |

## Recovery design

Three pieces, in order of value:

### 1. Re-attach on boot (core)

`SessionService` gains a recovery step that runs once at orchestrator startup. For every persisted session whose status is not `stopped`:

- **Container missing** → the session is orphaned (container was pruned or `kill()` was interrupted). Mark it `stopped` with a synthetic status event.
- **Container present** → re-attach: run the same harness preset against the existing container. The preset already passes `--session-dir /sessions/<id> --session-id <id>`, and pi's `--session-id` is documented as "Use exact project session ID, creating it if missing" — so the same argv resumes the exact conversation, not a fresh one. Subscribe event fan-out, re-emit history, and set a truthful status.

```mermaid
sequenceDiagram
    participant W as web.1 (new, boot)
    participant R as SessionRecoveryService
    participant D as Host Docker daemon
    participant A as agent-land-pi-&lt;id&gt;
    participant P as PiRpcHarness

    W->>R: recover() on startup
    R->>D: list containers with label agent-land/session-id
    loop each persisted session (status != stopped)
        alt container present
            R->>P: start(session) — same pi preset
            P->>D: exec pi --mode rpc --session-dir /sessions/&lt;id&gt; --session-id &lt;id&gt;
            D-->>P: duplex stream (session resumed)
            R->>R: handles.set(id, handle) · emit synthetic status
        else container missing
            R->>R: mark session stopped (orphaned)
        end
    end
```

Notes:

- An in-flight turn is cut when the stream dies; pi persists per turn, so after re-attach the user sees the last complete state and re-prompts. This is an accepted limitation, not something to engineer away.
- `waiting_for_input` sessions: `waitingFor` survives in the JSON record. If pi re-emits the pending `extension_ui_request` after resume, the normal flow continues; otherwise the user re-prompts. Best effort.
- The recovery step must be smoke-tested for the exact behavior of `--session-id` in rpc mode on the pinned image (`0.82.1`): resume (not fork/new) is the acceptance criterion.

### 2. Graceful drain on SIGTERM (hardening)

`server.ts` installs a SIGTERM handler that, for every live handle: sends `abort` (pi stops tool execution cleanly), then `stop()` (stream end). Dokku grants 30s (`ps:report` `stop timeout seconds: 30`), which is ample.

This does not *save* anything pi wouldn't already persist — it makes the cut cleaner and avoids pi being killed mid-tool-write (SIGKILL after grace) or mid-exec. It is hardening, not a prerequisite for recovery.

### 3. Persist the event log (nice-to-have)

Append events to `data/sessions/<id>.events.jsonl` (same cap as the in-memory ring buffer, trimmed on append). On boot and on SSE reconnect, replay from the file instead of empty history. Cheap, removes the "transcript vanished" symptom after redeploy. Not a prerequisite for recovery: pi's jsonl remains the source of truth.

## Status handling

No new status value: the existing states cover recovery.

- Boot recovery with live container → `idle` (agent is settled; a new prompt drives it to `running`).
- Orphaned container → `stopped`.
- The synthetic `status` event on re-attach is enough for the UI to re-render the session card; a follow-up UI nicety is a small "reconnected after redeploy" badge (out of scope here).

## Smoke-test plan

The design is grounded in observed behavior, but two claims must be verified against the real harness before implementation ships:

| # | Claim | Test |
|---|-------|------|
| 1 | `pi --mode rpc --session-id <id> --session-dir /sessions/<id>` on an existing session resumes it (same session id in events, prior conversation visible), not a new/forked session | Create session, prompt, kill only the web process (not the container), re-exec the same argv, assert resume |
| 2 | On orchestrator death, the pi exec exits (EOF) and the container survives | Already observed on a leftover smoke container; re-verify after drain is implemented |
| 3 | SIGTERM drain finishes within Dokku's 30s grace | Deploy while a session runs a long tool call; assert pi exited gracefully (jsonl complete) before SIGKILL |

## Explicitly out of scope

- Moving the harness out of the web process (per-session daemons, tmux-style supervisors) so agents survive *independent* of the orchestrator — a bigger architectural change; recovery via re-attach reaches the same user-visible outcome.
- Checkpointing of in-flight tool executions — pi's own per-turn persistence is the checkpoint.
- Full transcript fidelity across redeploys — the event log is best-effort; pi's session file is authoritative.
- Auto-pruning of orphaned containers/volumes — surfaced as `stopped`, cleanup stays manual.
