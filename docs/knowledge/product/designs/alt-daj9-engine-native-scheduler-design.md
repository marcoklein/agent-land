---
type: Design
title: Engine-native scheduler
description: A platform-native external scheduler that launches due sessions through the existing JSON/SSE API while keeping scheduling and orchestration outside the engine.
status: stable
generated: { by: pi/gpt-5.6-luna, at: 2026-09-17T14:15:00Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: platform-connector
    resource: /product/designs/platform-connector-design.md
    title: Platform Connector
  - id: ticket-layer
    resource: /product/designs/ticket-layer-design.md
    title: Ticket layer
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: Session lifecycle and capability injection
  - id: routes
    resource: packages/contracts/src/routes.ts
    title: Canonical API surface
---

# Engine-native scheduler

## Approach

Scheduling is native to the agent-land operating model but remains outside the in-core session engine. The v1 scheduler is the existing cron-driven laptop loop. It reads versioned schedule configuration, evaluates due times, claims a run atomically in the ticket repository, creates a `platform: true` session through the existing JSON API, watches its SSE stream, and records the result. The engine continues to provide sessions, capabilities, and observation; the loop owns due-time evaluation, retry policy, and gate-aware recipe behavior.

This is a deliberate boundary decision. The platform reference and domain boundary classify schedules and workflows as composition, and the engine has no workflow executor. An eventual hosted scheduler can use this same external contract, but putting schedule state or orchestration into `packages/server` is deferred and would require a new boundary ADR.

## Interfaces

### Schedule contract

A schedule file contains a version, stable schedule id, cron expression and timezone, enabled state, target ticket/recipe, session capability selections, concurrency policy, and timeout. It contains connector names—not secrets—and uses exact names already registered in the platform. A representative record is:

```yaml
version: 1
schedules:
  - id: ticket-loop
    cron: "*/5 * * * *"
    timezone: UTC
    enabled: true
    target: { repo: /workspace/tickets, tags: [loop] }
    session:
      platform: true
      connectors: [github]
      provider: opencode-go
      model: deepseek-v4-pro
      mounts: []
    concurrency: skip-if-running
    timeoutSec: 1800
```

The precise file path is a loop implementation detail. The stable id, version, due-time, concurrency, and session-selection fields are the compatibility contract.

### Session launch and observation

For each due run, the loop uses existing endpoints and fields:

- `POST /api/sessions`, including `platform`, `connectors`, `mounts`, `provider`, `model`, and `parentSession` as applicable.
- Session `GET` plus SSE event stream for recovery and settle detection.
- `DELETE /api/sessions/:id` for an explicit timeout/abort policy.
- Existing connector and mount registries by exact name.

No new server route, server schedule registry, database, or server-side orchestration contract is introduced. The platform connector supplies the launched session with its loopback URL and ephemeral credential.

### Durable run state

The ticket repository stores append-only run records keyed by `(scheduleId, runId)`, including planned time, actual start, session id, status, finish time, and failure/timeout reason. Atomic claims prevent normal overlapping ticks from launching duplicates. An expired claim is reconciled against live sessions before a retry. The scheduler is at-least-once across process crashes: retries are visible by run id and recipes must be safe to retry.

### Gates

A scheduled session may produce artifacts or open a PR, but it never approves or merges one. `waiting_for_input`, ticket labels, and human PR review remain the authority for outcome, design, and merge gates.

## Risks & mitigations

- **Crash-induced duplicates:** atomic claims, stable run ids, expiry, and live-session reconciliation.
- **Missed laptop intervals:** coalesce missed ticks into one run or record them as missed; never replay without bound.
- **Mount contention:** respect the one-live-session-per-mount invariant and defer a busy run.
- **Credential leakage:** store only connector names in schedule files; credentials remain in the platform registry.
- **Cost and runaway work:** require per-schedule timeouts, abort timed-out sessions, and persist the reason.
- **Boundary drift:** keep schedule interpretation in the loop; require a boundary ADR before adding it to the server.
- **Gate bypass:** do not merge or approve PRs from scheduled execution.

## ADR pointers

No new ADR is required for the recommended composition-layer v1. The design follows the engine boundary, Platform Connector, ticket-layer sync protocol, session contract, and Mount single-writer invariant. If “engine-native” is instead intended to mean an in-core scheduler, that is a scope deviation: pause implementation and first create an ADR amending the domain boundary. Do not silently add schedule state or a workflow executor to the engine.

## Minimal change set

- Loop/config in `agent-land-tickets`: schedule parsing, due-time evaluation, atomic claims, launch/watch, timeout, recovery, and append-only run records.
- Loop tests: cron evaluation, overlap and crash recovery, busy mounts, timeout, and run identity.
- No `packages/server` changes, no new API routes, no database, and no DAG/workflow executor.
