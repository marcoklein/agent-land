---
type: Reference
title: pi `--mode rpc` harness
description: How agent-land drives pi as a headless RPC process, and its lifecycle semantics.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-08-19T00:00:00Z }
verified: { by: human:marcoklein, at: 2026-09-01T00:00:00Z }
sources:
  - id: harness
    resource: packages/server/src/core/harness.ts
    title: AgentHarness port + pi RPC preset
  - id: pi-rpc-harness
    resource: packages/server/src/infra/pi-rpc-harness.ts
    title: Docker exec harness implementation
  - id: dockerfile
    resource: agent-image/Dockerfile
    title: Agent image (pi install)
  - id: recovery-test
    resource: packages/server/src/__tests__/session-recovery.test.ts
    title: Session recovery tests (resume + re-attach)
---

# Invocation

Pi runs headless inside the agent container, driven over a hijacked `docker exec` stream:

```
pi --mode rpc --provider <id> --model <id> --session-dir <dir> --session-id <id>
```

The provider comes from the session record (`session.provider ?? DEFAULT_PROVIDER_ID`), defaulting to `opencode-go`.[^harness] `--session-dir` points at the per-session transcript dir under the shared `agent-land-sessions` volume; `--session-id` pins the conversation to the session's own id.

# Process lifecycle

Pi's stdin/stdout is a `docker exec` stream **owned by the web process** (`PiRpcHarness.start`). This has hard consequences:[^recovery-test]

- When the web process dies (redeploy, crash), the exec socket closes and the stream hits EOF → **pi exits**.
- The **agent container survives** — it is a sibling container on the host Docker daemon (`sleep infinity` entrypoint), never managed by Dokku.
- Re-running the identical preset (`--session-dir <dir> --session-id <id>`) on a surviving container **resumes the same conversation** rather than forking a new session. Verified empirically 2026-08-17: a codeword set before the exec death was remembered after re-exec.

# Streaming

- Mid-turn prompts pass `streamingBehavior` (`steer` | `followUp`) through to pi.[^pi-rpc-harness] Without it, pi treats a mid-turn prompt as a separate empty turn.
- Pi persists its own per-session `jsonl` transcript to the `--session-dir`. This file is the **authoritative** record of the conversation; agent-land's event log is a best-effort projection of it.
- Pi has no model-listing command; see [Model Discovery](../providers/model-discovery.md) for how models are discovered without it.

[^harness]: `packages/server/src/core/harness.ts`, `piRpcPreset()`
[^pi-rpc-harness]: `packages/server/src/infra/pi-rpc-harness.ts`
[^recovery-test]: `packages/server/src/__tests__/session-recovery.test.ts`
