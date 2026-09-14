---
type: Feature
title: Ticket layer — agent-land-tickets as the system of record
description: A separate git-synced ticket repo (tk markdown) carrying the queue, a phase-label funnel, per-ticket HITD artifacts, and handoff thoughts — the durable state the ticket loop drives, reconciled against what actually lands as merged PRs.
status: draft
tags: [product, dogfooding, orchestration, tickets, hitd, playbook]
generated: { by: opencode/qwen3.8-max, at: 2026-09-14T00:00:00Z }
sources:
  - id: ticket-loop
    resource: /playbook/ticket-loop.md
    title: Ticket loop — the dogfooding heartbeat
  - id: pipeline
    resource: /product/pipeline.md
    title: The product pipeline
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding — the agent-land playbook
  - id: hitd
    resource: ~/.config/opencode/skills/hitd-workflow/SKILL.md
    title: HITD workflow skill (operator-local config)
  - id: adr-019
    resource: /adrs/019-ticket-layer-git-synced-repo.md
    title: Keep the ticket layer in a separate git-synced repo
---

# Ticket layer — agent-land-tickets as the system of record

The tracking backbone under the [product layer](/adrs/017-product-layer-okf-memory.md): a dedicated git-native repo, **agent-land-tickets**, holds the work queue as `tk` markdown tickets. It is the durable state the [ticket loop](/playbook/ticket-loop.md) drives — the concrete answer to that concept's "file-based `.tickets/` markdown" backend seam. Product *memory* (vision, Feature/Design notes, ADRs) stays in `agent-land` as OKF; the ticket layer holds *status and pointers*, never reasoning.

## Why

The product pipeline and the heartbeat loop both need one shared, durable place to answer *"given everything open right now, what is the single next step?"* Today that state is implicit — in a human's head, in scattered GitHub issues, or in a long-lived orchestrator session whose lifetime *is* the ticket's lifetime. A queue is shared mutable state; git branches are divergent copies; `agent-land`'s `main` is protected. So the queue needs its own home: a push-to-main repo of plain-markdown tickets that any agent can `pull --rebase`, read, advance one phase, and `push` — crash-proof, because the next tick re-derives state from the repo, not from memory[^adr-019].

This operationalizes [dogfooding](/playbook/dogfooding.md): the operator's day shrinks to intake (chat → ticket) and gate review, while a loop advances the funnel in between — and "the product's own velocity" becomes a countable thing (tickets reaching merged PRs).

## User stories

- As an operator, I want to chat an idea and have it land as a ticket in agent-land-tickets, so intake is frictionless and durable.
- As an operator, I want every ticket to carry a **phase label**, so I can read the funnel state at a glance (`tk ls -T needs-design`).
- As an operator, I want agents to refine raw tickets, split epics, and set dependencies directly in the repo, so the backlog shapes itself.
- As the loop, I want to pick the next `ready` ticket and advance it exactly one phase per tick with a fresh agent, so work flows without a human driving each step.
- As a step agent, I want to read my ticket's **thoughts** (the HITD handoff log) and artifacts, so I get full context with no carried state.
- As an operator, I want tickets to **park** at the design and merge gates, so I stay the approver and the loop never merges.
- As an operator, I want a **reconciliation** of the product funnel (intake → designed → approved) against the engineering funnel (planned → implemented → merged), so I see throughput, WIP, and what stalled where.

## Acceptance criteria

- **Repo.** `agent-land-tickets` exists, private, push-to-main, no CI; tickets are `tk` markdown + YAML frontmatter, id prefix `al-`; `tk` is vendored and pinned (upstream is quiet); deps `bash` + `jq`.
- **Phase-label funnel.** A fixed label set drives the loop: `loop` (opt-in), `needs-refinement → needs-questions → needs-research → needs-design → needs-structure → needs-plan → needs-implementation`, plus `human` (parked at a gate). Labels mirror the [HITD ladder](/playbook/ticket-loop.md#state-model--the-artifact-ladder).
- **Artifacts + thoughts.** Each ticket owns a workspace in the repo carrying the HITD artifact ladder (`task.md`, `questions.md`, `research.md`, `design.md`, `structure.md`, `plan.md`) and an append-only `thoughts` handoff log using `HITD_HANDOFF_V1` + `STATUS`[^hitd].
- **Sync protocol.** Every action: `git pull --rebase` → check precondition (still open, still ours) → claim (`tk start`, assignee = session git identity) → commit → `git push`. A **failed push invalidates the action**; re-pull, re-check, retry or back off. One ticket = one small file, so concurrent claims surface as a rebase conflict, never a silent overwrite.
- **Loop v1.** A bash driver advances one phase per tick, fresh agent per step, laptop-side (opencode) first; engine-side (`al run` + a mount of agent-land-tickets) later. No engine change in v1 — composition only.
- **Gates.** The design gate promotes the ticket's `design.md` into `agent-land`'s OKF bundle as a PR on the Design note (merge = approval, per ADR 017); the merge gate is the implementation PR on `agent-land`. The loop parks (`human`) at both and never approves or merges.
- **Reconciliation.** `external-ref` (the `agent-land` PR) joins ticket ↔ code; a report derives throughput (tickets with a merged implementation PR), WIP/leakage (approved design, no merged PR after N days), and per-label funnel conversion.

## Open questions

- **Design-gate home.** Promote `design.md` into `agent-land` OKF (this note's default, keeps ADR 017's "memory versioned with code"), or open the design PR *in agent-land-tickets* and let a web-ui consumer render it? The operator raised both; the Design note proposes the OKF-promotion default with the ticket-repo draft as the working copy.
- **Loop driver.** Laptop cron first, or make the [engine-native scheduler](/playbook/ticket-loop.md#generalization-seam-deliberately-thin) the loop's first self-built ticket?
- **Thoughts mechanism.** `tk add-note` (timestamped, in the ticket file) vs a separate `thoughts.md` in the ticket workspace — or both (notes for terse status, `thoughts.md` for full handoffs).
- **Label vs artifact authority.** When the phase label and the committed artifacts disagree, which wins? The Design note proposes: artifacts are the durable truth; the label is a cheap index the loop maintains and re-derives.
- **Scope.** agent-land-tickets is agent-land-specific in v1; does it generalize to a cross-repo queue (tickets carrying `repo` + `branch` + `external-ref`) once the platform orchestrates work across repos?

[^adr-019]: [ADR 019 — ticket layer in a separate git-synced repo](/adrs/019-ticket-layer-git-synced-repo.md)
[^hitd]: HITD workflow skill — operator opencode config (`skills/hitd-workflow/SKILL.md`): artifact ladder, `HITD_HANDOFF_V1`, STATUS protocol
