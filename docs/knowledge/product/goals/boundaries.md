---
type: DomainBoundary
title: Agent Land domain boundary
description: What agent-land is and, explicitly, what it is not — the fit-check reference for the refine stage so scope creep is revealed, not silently absorbed.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the purest form
  - id: strip-adr
    resource: /adrs/016-strip-web-ui-and-vendor-knowledge.md
    title: Strip Web UI and Vendor Knowledge from Server
  - id: product-adr
    resource: /adrs/017-product-layer-okf-memory.md
    title: Build a Product Layer on OKF Memory with an Agentic Pipeline
---

# Agent Land domain boundary

This note is the refine stage's *is it in scope?* check. Its counterpart, [the vision board](/product/goals/vision-board.md), answers *is it worth building?* Every outcome is measured against both before a Feature note is written. Out-of-bound outcomes aren't rejected outright — they are surfaced as **scope deviations**, resolved by one of: reject, reframe, or amend the boundary via an ADR.

## Is (in scope)

- The **engine itself**: the six primitives (Connector, Provider, Mount, Session, Event Stream, Platform Connector) and the three substrates (Docker, SOPS/Age, flat JSON)[^engine].
- The **CLI** (`al`) and the **JSON/SSE API** — the only surfaces.
- **Composition outside the engine**: recipes, workflows, schedules, gate disciplines (this product layer).

## Is not (out of scope — deliberate)

- **Presentation in-core.** No web UI, no server-rendered pages; anything graphical is a *separate consumer* of the JSON/SSE API, not part of this repo's engine[^strip-adr].
- **Orchestration in-core.** No DAG/workflow executor in the engine; control flow is a recipe concern[^engine].
- **Vendor knowledge in-core.** No provider catalog or connector field definitions in the engine; presets live in the CLI[^strip-adr].
- **Databases / multi-user auth.** Flat JSON + event logs for a single operator.

## Fit-check (refine stage, before writing a Feature note)

1. Does the outcome **compose from the six primitives**, or does it add/change a primitive?
2. Does it **violate an existing ADR** (especially 016)?
3. If it touches UI, orchestration, or vendor presets — is it **outside the engine** (a separate repo/client, or a recipe)?

If any answer signals out-of-scope, emit a **scope deviation first**, not a Feature note:

```
scope deviation: "<outcome>" conflicts with <ADR/boundary>
  options:
    1. reject (out of scope for agent-land)
    2. reframe as <separate client / recipe / external project>
    3. amend the boundary via a new ADR (deliberate, not drift)
```

[^engine]: [Agent Land engine](/engine.md)
[^strip-adr]: [Strip Web UI and Vendor Knowledge from Server](/adrs/016-strip-web-ui-and-vendor-knowledge.md)
[^product-adr]: [Build a Product Layer on OKF Memory with an Agentic Pipeline](/adrs/017-product-layer-okf-memory.md)
