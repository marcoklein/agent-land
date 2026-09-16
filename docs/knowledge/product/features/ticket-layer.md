---
type: Feature
title: Ticket layer — agent-land-tickets as the system of record
description: A separate git-synced ticket repo (tk markdown) holding the queue, a phase-label funnel, per-ticket HITD artifacts, and handoff thoughts — the durable state the ticket loop drives, reconciled against what lands as merged PRs.
status: draft
tags: [tickets, hitd, playbook]
generated: { by: opencode/qwen3.8-max, at: 2026-09-14T00:00:00Z }
sources:
  - id: ticket-loop
    resource: /playbook/ticket-loop.md
    title: Ticket loop — the dogfooding heartbeat
  - id: adr-019
    resource: /adrs/019-ticket-layer-git-synced-repo.md
    title: Keep the ticket layer in a separate git-synced repo
---

# Ticket layer — agent-land-tickets as the system of record

The tracking backbone under the [product layer](/adrs/017-product-layer-okf-memory.md): a git-native repo, **agent-land-tickets**, holds the work queue as `tk` markdown tickets. It is the durable state the [ticket loop](/playbook/ticket-loop.md) drives — the concrete answer to that concept's "file-based `.tickets/`" backend seam. Tickets carry *status and pointers*, never reasoning; reasoning stays in agent-land's OKF memory.

## Why

The pipeline and the loop need one shared, durable place to answer *"what is the single next step?"* A queue is shared mutable state, git branches are divergent copies, and agent-land's `main` is protected — so the queue needs its own push-to-main home that any agent can `pull --rebase`, advance one phase, and `push`[^adr-019]. This operationalizes [dogfooding](/playbook/dogfooding.md): the operator does intake and gate review, the loop advances the funnel, and velocity becomes countable.

## User stories

- As an operator, I want to chat an idea into a ticket, so intake is frictionless and durable.
- As an operator, I want every ticket to carry a phase label, so I read funnel state at a glance.
- As an operator, I want agents to refine tickets, split epics, and set deps in-repo, so the backlog shapes itself.
- As the loop, I want to pick the next `ready` ticket and advance it one phase per tick, so work flows without a human driving each step.
- As a step agent, I want to read my ticket's thoughts (HITD handoff) and artifacts, so I have full context with no carried state.
- As an operator, I want to reconcile the product funnel (intake→approved) against the engineering funnel (planned→merged), so I see throughput and what stalled.

## Acceptance criteria

- **Repo.** `agent-land-tickets`: private, push-to-main, no CI; `tk` markdown + frontmatter, id prefix `al-`; vendored pinned `tk`; deps `bash` + `jq`.
- **Funnel.** Labels drive the loop: `loop`, `needs-refinement → needs-questions → needs-research → needs-design → needs-structure → needs-plan → needs-implementation`, `human` (parked at a gate). Mirrors the [HITD ladder](/playbook/ticket-loop.md#state-model--the-artifact-ladder).
- **Artifacts + thoughts.** Each ticket owns a workspace: the HITD ladder (`task.md`…`plan.md`) + an append-only `thoughts` log (`HITD_HANDOFF_V1` / `STATUS`).
- **Sync.** `pull --rebase` → precondition → claim (`tk start`, assignee = session identity) → commit → push; a failed push invalidates the action. Concurrent claims surface as a rebase conflict, never a silent overwrite.
- **Loop v1.** A bash driver advances one phase per tick with a fresh agent; laptop first (opencode), engine later (`al run` + mount). No engine change in v1.
- **Gates.** Design gate = a PR promoting `design.md` into agent-land OKF (merge = approve); merge gate = the implementation PR. The loop parks (`human`) and never merges.
- **Reconciliation.** `external-ref` (the agent-land PR) joins ticket↔code; a report derives throughput, WIP/leakage, and per-label conversion.

## Open questions

- **Design-gate home.** Promote into agent-land OKF (default here, keeps ADR 017), or PR in agent-land-tickets + a web-ui render?
- **Loop driver.** Laptop cron first, or the [engine-native scheduler](/playbook/ticket-loop.md#generalization-seam-deliberately-thin) as the loop's first self-built ticket?
- **Thoughts mechanism.** `tk add-note`, a separate `thoughts.md`, or both?
- **Label vs artifact authority.** On disagreement the Design note proposes artifacts win, label re-derived.
- **Scope.** agent-land-only in v1, or a cross-repo queue (tickets carrying `repo` + `branch`)?

[^adr-019]: [ADR 019 — ticket layer in a separate git-synced repo](/adrs/019-ticket-layer-git-synced-repo.md)
