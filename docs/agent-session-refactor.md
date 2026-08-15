# Agent Session Refactor — Implementation Plan

Self-contained implementation document. An agent reading only this file can implement the refactor.

## 1. Context & goal

agent-land currently runs pi **one-shot** (fire-and-forget, `--mode json`) and, via a just-merged SSH feature, **interactive** containers (`sleep infinity` + exec pi TUI). We are refactoring into a single model:

> **Every session is a running agent**, driven by pi as a **harness** in `--mode rpc` mode, controlled through **one HTTP + SSE API**, consumed by the website. **SSH is removed entirely.**

### Locked decisions (read first)

- **D1 — Unified entity.** One `AgentSession` replaces both the one-shot `AgentRun` and the interactive session. One-shot = a session with `permissionPolicy: "auto"`.
- **D2 — pi is the harness, RPC only.** The harness spawns `pi --mode rpc` in the session container and speaks JSONL. No TUI, no `--mode json`, no `--mode text`. `buildPiCmd` and the one-shot json-mode path are deleted.
- **D3 — Drop SSH.** Delete `ssh-server.ts`, SSH config fields, `ssh2` dependency. No terminal/pty relay. The website is the only client (chat via SSE + POST).
- **D4 — One control surface.** `SessionService` (in `core/`) is the single door. `presentation/http/` exposes it as REST + SSE. No per-presentation verb grammar.
- **D5 — HITL = a state, not a prompt.** pi's `extension_ui_request` (confirm/input/select/editor) maps to `SessionStatus.waiting_for_input`; answered via `respond()` → `extension_ui_response`.
- **D6 — permission policy.** `permissionPolicy: "auto" | "manual"`. `auto` = auto-answer dialogs (confirm→true, select→first option, input→""); `manual` = pause and wait. This is the only HITL knob.
- **D7 — Ports & adapters.** Core depends only on interfaces (`ports.ts`); `infra/` implements them; `presentation/` calls the core. Single process, multiple modules (no separate binary).
- **D8 — Minimal.** No loop driver, no MCP/CLI, no browser xterm, no terminal REPL. These hang off later without touching the core.

### Non-goals (deferred, do NOT build)

Loop/autonomous orchestration, JSON API for agents/MCP, browser terminal (xterm), terminal REPL client.

---

## 2. Current state (what you're changing)

| File | Role today | Fate |
|---|---|---|
| `src/types.ts` | `AgentRun`, `KillSwitch`, `LogEntry`, `Connector`, `SecretInfo`, `DecryptedSecret` | **delete**; `Connector`+secret types move to `core/types.ts`, the rest retired |
| `src/services/docker.ts` | `DockerService`: `createAndStartContainer`, `streamLogs`, `waitForExit`, `stopContainer`, `ensureAgentImage`, `removeContainer`, `createInteractiveContainer`, `listInteractiveContainers`, `execInteractive`, `buildPiCmd`, `SESSION_VOLUME_NAME`, `demuxStream` | move to `infra/docker.ts`; **drop** `createAndStartContainer`, `streamLogs`, `waitForExit`, `demuxStream`, `buildPiCmd` |
| `src/services/sops.ts` | `SopsService` | move to `infra/sops.ts` |
| `src/services/agent-runner.ts` | `AgentRunner`: `resolveAgentEnv`, `launch`, `kill`, `getRun`, `listRuns`, `streamLogs`, `saveRun`, `loadRun`, `loadConnectorsData` | **delete**; split into `core/session-service.ts` + `infra/repositories.ts` (+ keep `resolveAgentEnv`) |
| `src/services/ssh-server.ts` | ssh2 server (just merged) | **delete** |
| `src/services/log-renderer.ts` | json-mode event → HTML | move to `presentation/http/log-renderer.ts`, migrate to canonical events |
| `src/services/prompt.ts` | `buildPrompt` | move to `core/prompt.ts` |
| `src/services/providers.ts` | `getModels` | move to `infra/providers.ts` |
| `src/routes/agents.ts` | launch/list/detail/SSE/kill/stats | thin over `SessionService` (list sessions) |
| `src/routes/connectors.ts` | connector CRUD + file I/O | thin over `ConnectorService` |
| `src/routes/index.ts` | home (reads run files) | home over `SessionService` |
| `src/config.ts` | config (has SSH fields) | remove SSH fields |
| `src/server.ts` | composition root + `startSshServer` | composition root only |
| `src/views/*.ejs` | agents list/show, connectors | adapt to sessions |
| `agent-image/Dockerfile` | skills at `/tmp/pi-config/skills/` | **keep as-is** |
| `package.json` | deps incl. `ssh2` | remove `ssh2`, `@types/ssh2` |
| `.env.example` | env docs incl. SSH vars | remove SSH vars |

Keep from the recent SSH PR (they become the harness foundation): `createInteractiveContainer`, `listInteractiveContainers`, `execInteractive`, `SESSION_VOLUME_NAME`, and the `resolveAgentEnv` extraction.

---

## 3. Target architecture

```
                    ┌────────────────────────────────────────────┐
                    │                 core/                     │
                    │  AgentSession  (status machine)           │
                    │  AgentHarness ◀── port                    │
                    │  SessionService / ConnectorService        │
                    │  ports.ts (DockerPort, SecretsPort, repos)│
                    └───────┬──────────────────────────┬────────┘
                            │                          │
                    ┌───────▼────────┐        ┌────────▼─────────┐
                    │ infra/         │        │ presentation/    │
                    │ docker         │        │  http/  (api +   │
                    │ sops           │        │   views + SSE)   │
                    │ pi-rpc-harness │        └──────────────────┘
                    │ repositories   │
                    └────────────────┘
```

### Directory layout (final)

```
src/
  config.ts                       # no SSH fields
  server.ts                       # composition root
  core/
    types.ts                      # AgentSession, SessionStatus, PermissionPolicy, Connector, SecretInfo, DecryptedSecret
    events.ts                     # SessionEvent
    harness.ts                    # AgentHarness, AgentHandle, EventStream, ProgramSpec, presets
    ports.ts                      # DockerPort, SecretsPort, SessionRepository, ConnectorRepository
    session-service.ts            # SessionService
    connector-service.ts          # ConnectorService
    prompt.ts                     # buildPrompt (moved)
  infra/
    docker.ts                     # DockerPort impl
    sops.ts                       # SecretsPort impl
    pi-rpc-harness.ts             # PiRpcHarness
    repositories.ts               # JSON SessionRepository + ConnectorRepository
    providers.ts                  # getModels (moved)
  presentation/
    http/
      api-sessions.ts             # /api/sessions REST + SSE
      log-renderer.ts             # canonical SessionEvent -> HTML
  routes/                         # thin EJS page routes (agents, connectors, index)
  views/                          # adapted EJS templates
  __tests__/                      # updated tests
```

---

## 4. Domain model

### `core/types.ts`

```ts
export type PermissionPolicy = "auto" | "manual";
export type SessionStatus = "running" | "waiting_for_input" | "idle" | "stopped";

export interface AgentSession {
  id: string;                    // short id = container name/label suffix (8 chars)
  status: SessionStatus;
  permissionPolicy: PermissionPolicy;
  sessionDir: string;            // `/sessions/<id>`
  connectors: string[];
  model: string;
  createdAt: string;
  updatedAt: string;
  containerId?: string;
  waitingFor?: {
    requestId: string;
    method: "confirm" | "input" | "select" | "editor";
    prompt?: string;             // title/message from the dialog
  };
}

export interface Connector {      // unchanged from today
  name: string;
  type: "jira" | "github" | "gmail" | "custom";
  url: string;
  secretFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretInfo { name: string; filename: string; size: number; modifiedAt: string; }
export interface DecryptedSecret { name: string; content: string; }
```

Notes:
- `Run`/`AgentRun`/`KillSwitch`/`LogEntry` are **gone**. The old `data/runs/*.json` and `data/logs/*.jsonl` are superseded by `data/sessions/*.json` + pi's own session files on the volume.
- Token/cost tracking: retain *if* the rpc `message_end` carries `message.usage` (see §11 open items). Otherwise drop the stats UI.

### `core/events.ts`

```ts
export type SessionEvent =
  | { type: "status"; status: SessionStatus }
  | { type: "turn_start" }
  | { type: "turn_end"; message?: unknown; toolResults?: unknown[] }
  | { type: "message_delta"; text: string }                 // streaming text
  | { type: "message_end"; message: unknown }               // full assistant/user message
  | { type: "tool_start"; toolCallId: string; toolName: string; args?: unknown }
  | { type: "tool_update"; toolCallId: string; toolName: string; partial?: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; result?: unknown; isError: boolean }
  | { type: "agent_settled" }
  | { type: "waiting_for_input"; requestId: string; method: string; prompt?: string }
  | { type: "input_received"; requestId: string };
```

### `core/harness.ts`

```ts
export type EventStream = {
  subscribe(handler: (e: SessionEvent) => void): () => void;   // returns unsubscribe
};

export interface AgentHarness {
  start(session: AgentSession): Promise<AgentHandle>;
}

export interface AgentHandle {
  events(): EventStream;
  prompt(message: string, behavior?: "steer" | "followUp"): Promise<void>;
  respond(requestId: string, value: { value?: string; confirmed?: boolean; cancelled?: boolean }): Promise<void>;
  abort(): Promise<void>;
  stop(): Promise<void>;   // kill the underlying rpc process (do not remove container)
}

export type ProgramSpec = { argv: string[]; tty: boolean };

// rpc argv for a session's pi harness
export function piRpcPreset(session: AgentSession): ProgramSpec {
  return {
    argv: [
      "pi", "--mode", "rpc",
      "--provider", "opencode-go",
      "--model", session.model,
      "--session-dir", session.sessionDir,
      "--session-id", session.id,
    ],
    tty: false,
  };
}
```

---

## 5. pi RPC protocol (verified against pi 0.82.1)

Reference: `docs/rpc.md` inside the image (`/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`).

- **Start**: `pi --mode rpc [--provider <name>] [--model <pattern>] [--session-dir <path>] [--session-id <id>] [--no-session]`.
- **Transport**: JSONL over stdin/stdout. **LF (`\n`) is the only record delimiter.** Do NOT use Node `readline` (it splits on U+2028/U+2029, which are valid inside JSON strings). Implement a manual `\n` splitter that strips a trailing `\r`.
- **Commands** (single-line JSON to stdin): `prompt`, `steer`, `follow_up`, `abort`, `new_session`, `get_state`, `get_messages`, `switch_session`, `set_model`, `compact`, `bash`, `abort_bash`.
- **Responses** (stdout): `{"type":"response","command":"prompt","success":true}` — or `success:false` with `error`.
- **Events** (stdout): `agent_start`, `agent_end`, `agent_settled`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `bash_execution_update`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `queue_update`, `compaction_start/end`, `auto_retry_start/end`, `extension_error`.
- **`agent_settled`**: "agent run fully settled; no retry/compaction/queued continuation remains" → this is the **idle** signal.
- **HITL (Extension UI Protocol)**:
  - Agent emits `extension_ui_request` on stdout with a `method` and unique `id`.
  - Dialog methods (block until answered): `select`, `confirm`, `input`, `editor`.
  - Fire-and-forget (no response): `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`.
  - Client answers with `extension_ui_response` on stdin, matching `id`:
    - select/input/editor → `{"type":"extension_ui_response","id":...,"value":"..."}`
    - confirm → `{"type":"extension_ui_response","id":...,"confirmed":true}`
    - cancel → `{"type":"extension_ui_response","id":...,"cancelled":true}`

Key command examples:

```json
{"type":"prompt","message":"Hello, world!"}
{"type":"prompt","message":"New instruction","streamingBehavior":"steer"}
{"type":"abort"}
```

Key event examples:

```json
{"type":"agent_start"}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hello "}}
{"type":"message_end","message":{...}}
{"type":"tool_execution_start","toolCallId":"call_abc","toolName":"bash","args":{"command":"ls -la"}}
{"type":"tool_execution_end","toolCallId":"call_abc","toolName":"bash","result":{...},"isError":false}
{"type":"agent_settled"}
{"type":"extension_ui_request","id":"uuid-1","method":"confirm","title":"Clear session?","message":"All messages will be lost."}
```

### RPC → canonical event mapping

| rpc event | canonical `SessionEvent` |
|---|---|
| `agent_start` | `{type:"status", status:"running"}` |
| `agent_settled` | `{type:"agent_settled"}` + `{type:"status", status:"idle"}` (or `waiting_for_input` if a dialog is pending) |
| `agent_end` | (no-op for v1, or emit `status` only) |
| `turn_start` / `turn_end` | passthrough |
| `message_start` | (no-op) |
| `message_update` (`assistantMessageEvent.type==="text_delta"`) | `{type:"message_delta", text: delta}` |
| `message_end` | `{type:"message_end", message}` |
| `tool_execution_start` | `{type:"tool_start", toolCallId, toolName, args}` |
| `tool_execution_update` | `{type:"tool_update", toolCallId, toolName, partial: partialResult}` |
| `tool_execution_end` | `{type:"tool_end", toolCallId, toolName, result, isError}` |
| `extension_ui_request` (dialog method) | `{type:"waiting_for_input", requestId:id, method, prompt: title}` + set `status:"waiting_for_input"` |
| `extension_ui_request` (fire-and-forget) | ignore (v1) |

`message_delta` should **accumulate** text per `message_update` so the `message_end` handler (and any terminal/browser client) can render full messages. Emit `message_delta` for streaming, `message_end` for the complete message.

---

## 6. State machine

```
create → idle
  prompt → running ──(agent_settled)──▶ idle
            └──(extension_ui_request, manual)──▶ waiting_for_input ──respond──▶ running/idle
  kill → stopped
```

- `SessionService.prompt()` sends `prompt` to the harness and sets `status:"running"`.
- On `agent_settled`: if `manual` and a dialog is pending → `waiting_for_input`; else → `idle`.
- On `extension_ui_request` (dialog) with `permissionPolicy:"manual"`: set `waiting_for_input`, store `waitingFor`.
- With `permissionPolicy:"auto"`: immediately answer the dialog (default per method), never set `waiting_for_input`.
- `respond(requestId, value)` sends `extension_ui_response`, clears `waitingFor`, sets status back to `running`.
- `kill()` aborts + stops the harness and removes the container, sets `stopped`.

---

## 7. Control surface (HTTP)

All JSON, mounted under `/api/sessions`:

```
POST   /api/sessions                body: { connectors?: string[], permissionPolicy?: "auto"|"manual", model?: string } → { session: AgentSession }
GET    /api/sessions                → { sessions: AgentSession[] }
GET    /api/sessions/:id            → { session: AgentSession }
POST   /api/sessions/:id/prompt     body: { message: string } → 202 { accepted: true }
POST   /api/sessions/:id/respond    body: { requestId: string, value?: string, confirmed?: boolean, cancelled?: boolean } → 200
POST   /api/sessions/:id/abort      → 200
DELETE /api/sessions/:id            → 200 (kill + remove container)
GET    /api/sessions/:id/events     SSE stream of canonical SessionEvent JSON (see below)
```

SSE framing (mirror the existing `/agents/:id/logs` style in `routes/agents.ts`):

```
data: <json>\n\n
```

Plus an `event: agent-done` / close when the session reaches a terminal state (`stopped`). The stream stays open on `idle` (a live session).

---

## 8. `SessionService` responsibilities (`core/session-service.ts`)

- Holds a `Map<string, SessionHandle>` where `SessionHandle = { session, harness: AgentHandle, subscribers: Set<(e)=>void>, rpcProcess }`.
- `createSession({connectors, permissionPolicy, model})`:
  1. resolve env via `resolveAgentEnv(connectors)` (moved from `AgentRunner`, using `SecretsPort` + config).
  2. `docker.ensureAgentImage(config.agentImage)`.
  3. `id = randomUUID().slice(0,8)`.
  4. `docker.createInteractiveContainer({ id, envVars, image, sessionVolume: SESSION_VOLUME_NAME })` (unchanged — `sleep infinity`).
  5. persist `AgentSession` (status `idle`) via `SessionRepository.save`.
  6. start harness (`harness.start(session)`), subscribe to events, drive the state machine + broadcast to subscribers.
- `listSessions()`, `getSession(id)` via repository.
- `prompt(id, message)`, `respond(id, requestId, value)`, `abort(id)`, `kill(id)`.
- `streamEvents(id): EventStream` — subscribe to the in-memory fan-out; also replay recent persisted events (optional in v1).
- `resolveAgentEnv(connectors)` — extracted verbatim from `AgentRunner` (decrypt via `SecretsPort`, inject `OPENCODE_API_KEY`/`OPENCODE_API_URL`, per-connector `*_URL`).

---

## 9. `PiRpcHarness` (`infra/pi-rpc-harness.ts`)

- Constructor takes `DockerPort` + `Config`.
- `start(session)`:
  1. `const handle = await docker.execInteractive(containerId(session), piRpcPreset(session).argv)` where `containerId(session) = \`agent-land-pi-${session.id}\``.
  2. **Own the stream**: `execInteractive` already returns `{ stream, resize }` with `Tty:true` on `exec.start` — for rpc we do NOT need a tty, so create a variant `execInteractiveRaw(containerId, argv)` (or add a `tty` param to `execInteractive`) that sets `Tty:false` and `exec.start({hijack:true, stdin:true, Tty:false})` to get a non-multiplexed raw duplex. **Important:** keep the `Tty` flag on `exec.start` consistent with the exec create `Tty` flag to avoid Docker multiplexing (see note below).
  3. Split stdout on `\n` only; parse each JSON line; ignore non-JSON lines and `type:"response"` lines.
  4. Map events per §5 table, emit into the `EventStream` (a `Set` of handlers).
  5. Expose `prompt/respond/abort/stop` that write single-line JSON to the stream.
- `prompt`: `{"type":"prompt","message":<message>}` (+ `streamingBehavior` when provided).
- `respond`: `{"type":"extension_ui_response","id":requestId,...}`.
- `abort`: `{"type":"abort"}`.
- `stop`: `stream.end()` / kill rpc process.
- **Framing helper**: implement a small `LineSplitter` transform (Buffer accumulate, split on `\n`, strip `\r`) — do NOT use `readline`.

> Docker note (learned the hard way): dockerode's `exec.start` decides raw-vs-multiplexed streaming from the **start request's `Tty`**, not the create config. Keep them consistent: `container.exec({Tty:false, AttachStdin/out/err})` + `exec.start({hijack:true, stdin:true, Tty:false})` gives a raw (non-multiplexed) duplex. (For the old TUI attach we needed `Tty:true` on both.)

---

## 10. Ports (`core/ports.ts`) + infra impls

```ts
export interface DockerPort {
  createInteractiveContainer(opts: { id: string; envVars: Record<string,string>; image: string; sessionVolume: string }): Promise<Docker.Container>;
  listInteractiveContainers(): Promise<Array<{ id: string; name: string; status: string }>>;
  execInteractive(containerId: string, args: string[], tty: boolean): Promise<InteractiveExec>;
  stopContainer(id: string): Promise<void>;
  removeContainer(id: string): Promise<void>;
  ensureAgentImage(image: string): Promise<void>;
}
export interface InteractiveExec { stream: NodeJS.ReadWriteStream; resize(h: number, w: number): Promise<void>; }

export interface SecretsPort {
  decrypt(filename: string): Promise<DecryptedSecret>;
  decryptMultiple(filenames: string[]): Promise<Map<string,string>>;
  encrypt(name: string, plaintext: string): Promise<string>;
  saveEncrypted(name: string, plaintext: string): Promise<void>;
  listSecrets(): Promise<SecretInfo[]>;
  deleteSecret(name: string): Promise<void>;
  secretExists(name: string): Promise<boolean>;
}

export interface SessionRepository { save(s: AgentSession): Promise<void>; get(id: string): Promise<AgentSession|null>; list(): Promise<AgentSession[]>; }
export interface ConnectorRepository { list(): Promise<Connector[]>; save(list: Connector[]): Promise<void>; }
```

- `infra/docker.ts`: copy the current `DockerService` class; rename to implement `DockerPort`; add the `tty` param to `execInteractive`; **remove** `createAndStartContainer`, `streamLogs`, `waitForExit`, `demuxStream`, `buildPiCmd`.
- `infra/sops.ts`: copy `SopsService` unchanged, implement `SecretsPort`.
- `infra/repositories.ts`: JSON files under `config.dataDir` — `data/sessions/<id>.json`, `data/connectors.json` (reuse the current file I/O patterns from `AgentRunner.saveRun/loadRun/loadConnectorsData` and `routes/connectors.ts`).

---

## 11. Open items to verify during implementation

1. **`message_end` usage shape in rpc mode.** The old stats UI (`totalTokens`/`totalCost`) read `event.message.usage` on json-mode `message_end`. Verify rpc `message_end` carries the same `message.usage`. If yes, keep token/cost accumulation in `SessionService`; if not, drop the stats UI.
2. **`auto` policy defaults.** Confirm sensible auto-answers per dialog method (confirm→`{confirmed:true}`, select→first option, input/editor→`{value:""}`). If "auto" should instead use pi's own `--approve`-style trust flag, prefer auto-answering dialogs (simpler, uniform).
3. **Session persistence reconciliation.** `data/sessions/<id>.json` (our record) vs pi's own `/sessions/<id>/*.jsonl` on the volume. Our record is the source of truth for status/policy; pi's files are the agent history. Don't read pi's files in v1.
4. **Event fan-out.** `SessionService` broadcasts every event to all subscribers (SSE). Unsubscribe on client disconnect. Guard against backpressure by dropping slow subscribers.

---

## 12. File-by-file plan

### New

| File | Content |
|---|---|
| `src/core/types.ts` | §4 types |
| `src/core/events.ts` | §4 `SessionEvent` |
| `src/core/harness.ts` | §4 `AgentHarness`, `AgentHandle`, `EventStream`, `ProgramSpec`, `piRpcPreset` |
| `src/core/ports.ts` | §10 interfaces |
| `src/core/session-service.ts` | §8 `SessionService` |
| `src/core/connector-service.ts` | connector CRUD (moved from `routes/connectors.ts`), uses `ConnectorRepository` + `SecretsPort` |
| `src/core/prompt.ts` | `buildPrompt` (moved verbatim from `src/services/prompt.ts`) |
| `src/infra/docker.ts` | §10 `DockerPort` impl (moved+trimmed from `src/services/docker.ts`) |
| `src/infra/sops.ts` | `SecretsPort` impl (moved verbatim) |
| `src/infra/pi-rpc-harness.ts` | §9 `PiRpcHarness` |
| `src/infra/repositories.ts` | §10 JSON `SessionRepository` + `ConnectorRepository` |
| `src/infra/providers.ts` | `getModels` (moved) |
| `src/presentation/http/api-sessions.ts` | §7 REST + SSE router |
| `src/presentation/http/log-renderer.ts` | canonical `SessionEvent` → HTML (adapt existing `renderLogEntry` switch to §4 events) |

### Modified

| File | Change |
|---|---|
| `src/config.ts` | remove `sshHost`, `sshPort`, `sshHostKeyFile`, `sshAuthorizedKey` (fields + `getConfig` entries) |
| `src/server.ts` | build `sops`/`docker`/`harness`/`sessionService`/`connectorService`; mount `api-sessions`, `routes/*`; **no** `startSshServer` |
| `src/routes/agents.ts` | thin over `SessionService`: list sessions (replaces run list), `/:id` detail, `/:id/events` (delegate to api-sessions or SSE), kill. Remove launch form post (migrate to `createSession` + `prompt`). |
| `src/routes/connectors.ts` | thin over `ConnectorService` (drop inline file I/O) |
| `src/routes/index.ts` | home over `SessionService` (sessions instead of runs) |
| `src/views/*.ejs` | rename "runs/agents" → "sessions"; adapt data shape (`AgentSession` fields) |
| `package.json` / `package-lock.json` | remove `ssh2`, `@types/ssh2` |
| `.env.example` | remove the four `SSH_*` vars |

### Deleted

- `src/services/ssh-server.ts`
- `src/services/agent-runner.ts`
- `src/services/docker.ts`, `src/services/sops.ts`, `src/services/log-renderer.ts`, `src/services/providers.ts`, `src/services/prompt.ts` (all moved)
- `src/types.ts`

### Keep unchanged

- `agent-image/Dockerfile` (skills fix), `src/views/partials/*`, `public/`, `vitest.config.ts`, `tsconfig.json`, `.gitignore`.

---

## 13. Phased execution (each phase ends with `npm run typecheck` + `npm test` green)

### Phase 1 — Remove SSH

- Delete `src/services/ssh-server.ts`.
- Remove SSH fields from `src/config.ts` + `src/server.ts` (`startSshServer`, `DockerService` import).
- Remove `ssh2`, `@types/ssh2` from `package.json` (`npm uninstall ssh2` / `npm uninstall -D @types/ssh2`).
- Remove SSH vars from `.env.example`.
- Verify: typecheck, tests (untouched), app boots (`npm run dev`) with only the HTTP port.

### Phase 2 — Extract ports + repos (pure refactor, zero behavior change)

- Move `DockerService` → `infra/docker.ts` (still the same class shape; drop json-mode methods later in Phase 4, or now — either, but keep `execInteractive`).
- Move `SopsService` → `infra/sops.ts`.
- Add `core/ports.ts` interfaces; have the impls implement them.
- Add `ConnectorService` (`core/`) + `ConnectorRepository` (`infra/repositories.ts`); rewrite `routes/connectors.ts` to call it.
- Move `prompt.ts` → `core/prompt.ts`, `providers.ts` → `infra/providers.ts`.
- Verify: connectors tests green; `POST /agents/run` still works.

### Phase 3 — Harness + session-service + API (new capability, side-by-side with one-shot)

- Add `core/types.ts` (`AgentSession`), `core/events.ts`, `core/harness.ts`.
- Add `infra/pi-rpc-harness.ts` (§9) with the `LineSplitter` framing + mapping (§5).
- Add `core/session-service.ts` (§8) with state machine (§6).
- Add `SessionRepository` (`infra/repositories.ts`).
- Add `presentation/http/api-sessions.ts` (§7) + mount in `server.ts`.
- Verify headless: `POST /api/sessions` → `POST /:id/prompt` → observe events (via a quick `curl -N` on the SSE endpoint) → `agent_settled`; with `manual` policy, drive a dialog and `POST /:id/respond`.

### Phase 4 — Migrate one-shot, retire old path

- Replace `AgentRunner.launch` usage in `routes/agents.ts` with `SessionService.createSession({permissionPolicy:"auto"})` + `prompt`.
- Delete `src/services/agent-runner.ts`, `src/types.ts`.
- Remove `createAndStartContainer`, `streamLogs`, `waitForExit`, `demuxStream`, `buildPiCmd` from `infra/docker.ts`.
- Migrate `log-renderer.ts` to canonical events; update `views`.
- Rewrite `agents.test.ts` to mock `DockerPort` + a fake harness (or `AgentHarness` with an in-memory event emitter) instead of `MockDockerService`. Keep coverage semantics: launch → session listed as running; events stream to detail page; kill; stats.
- Verify: full `npm test` green.

### Phase 5 — Cleanup + deployment rollback

- `dokku config:unset agent-land SSH_AUTHORIZED_KEY SSH_HOST`
- `dokku ports:remove agent-land tcp:2222:2222`
- `dokku network:set agent-land bind-all-interfaces false`
- `dokku ps:rebuild agent-land`
- Update `README.md` (drop SSH section; document the sessions API).

---

## 14. Verification checklist

Automated:
- `npm run typecheck` passes.
- `npm test` passes (migrated suite).

Manual (local `npm run dev`):
- `POST /api/sessions` → returns a session id; `docker ps` shows `agent-land-pi-<id>` running `sleep infinity`.
- `POST /api/sessions/:id/prompt {message:"..."}` runs against OpenCode Go (needs `OPENCODE_API_KEY` in `.env`).
- `curl -N /api/sessions/:id/events` streams `status`, `message_delta`, `message_end`, `tool_*`, `agent_settled`.
- With `permissionPolicy:"manual"`, a dialog produces `waiting_for_input`; `POST /:id/respond` resumes.
- `DELETE /api/sessions/:id` stops and removes the container.
- Website list/detail renders sessions; live stream via SSE.

---

## 15. Summary of decisions

Implemented per decisions D1–D8 (§1). Deviations/notes:
- **`message_delta` accumulation** — the harness accumulates `text_delta` deltas so `message_end` can carry full text for rendering; both the delta and the full message are emitted.
- **Stats UI** is conditional on `message.usage` surviving in rpc `message_end` (§11.1); drop it if absent.
- **No `ExecutionProcess` entity** — "execution" is implicit in `status` (`running` = an execution in progress); see D1/D8. (Vibe Kanban's session/execution split is deliberately not modeled in v1.)
- **`resize`** is retained on `InteractiveExec` for API symmetry but unused now (no terminal). Keep the field; don't build resize plumbing.
