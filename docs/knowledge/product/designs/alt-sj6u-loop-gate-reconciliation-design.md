---
type: Design
title: Loop reconciles gates — merged PR advances, review feedback sends back
description: The loop reads a parked ticket's recorded pull request and advances, closes, or unparks it — merge and comment become the only two inputs at a gate.
status: stable
tags: [tickets, hitd, loop, okf]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-20T16:20:00Z }
sources:
  - id: loop
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/loop.sh
    title: Loop driver — park, retag, tick
  - id: tk
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/tk
    title: tk — ticket CLI and frontmatter writer
  - id: ticket-layer
    resource: /product/designs/ticket-layer-design.md
    title: Ticket layer (parent design)
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
---

# Loop reconciles gates

## Problem

When a design or implementation pull request reaches the human gate, the loop parks the
ticket and never looks at it again. Merging the pull request does not move the ticket; a
review comment does not send it back. The only way forward is a human editing the ticket's
tags by hand. The gate should take exactly two inputs: merge to approve, a change request
to send back.

## Decision requested

1. **Keep the phase tag when parking.** Park as `tags: [loop, human, needs-design]` (or
   `needs-implementation`) instead of dropping the phase, so the loop can tell the design
   gate from the merge gate. *Rejected:* a new frontmatter field for the gate — new state,
   a new writer, more places to drift.
2. **"Send back" means the review decision, not the comments.** A pull request whose review
   decision is `CHANGES_REQUESTED` sends the ticket back; anything else — including comments
   and failing checks — does not. *Rejected:* any review comment or red check as a send-back
   signal (comments can be notes; a red check is transient).
3. **One `external-ref`, overwritten.** The implementation agent overwrites `external-ref`
   with its own pull request when it opens one; a tickets-only change opens none, so the
   already-merged design PR still closes the ticket at the merge gate. *Rejected:* a second
   frontmatter field for the implementation PR.

## Approach

Reconciliation is loop-driver behaviour in the tickets repo, never engine work — the domain
boundary already places gate disciplines in the composition layer[^boundary].

The tick currently skips every `human` ticket before doing anything
(`loop.sh:202-205`). The check runs before that skip: for each ready ticket that is
`human` and carries `external-ref`, read the pull request and act, then let the normal tick
resume. One process — the loop — owns ticket mutation, so there is no second writer to race.

`gh pr view <n> --json state,reviewDecision` returns the two facts the check needs. The
mapping, keyed on the parked phase tag:

| Parked phase | Merged | Changes requested | Anything else |
|---|---|---|---|
| `needs-design` | advance to `needs-structure` | un-park back to `needs-design` | stay parked |
| `needs-implementation` | close the ticket | un-park back to `needs-implementation` | stay parked |

Only these two gate phases act. A ticket parked at `human` for another reason (spawn
failure, blocked, no handoff) has no `external-ref` naming an open pull request, so the
check leaves it alone — the `human` skip still applies.

Un-parking is the inverse of parking: drop the `human` tag and restore the bare phase tag,
so the next tick re-runs that phase. Parking itself changes from dropping the phase to
keeping it: `retag_ticket` writes `tags: [loop, human, <phase>]`
(`loop.sh:158-162`, call sites `:247`, `:270-273`).

## Interfaces

- **Ticket frontmatter** — `external-ref` already exists (`tk:183`); the design agent writes
  it today. The implementation agent now overwrites it with its own PR when it opens one,
  and a tickets-only change leaves it untouched.
- **needs-implementation prompt** (`loop.sh:56`) — gains the same completion condition as
  needs-design: record `external-ref: gh-<number>` when an agent-land PR is opened.
- **`run_tick`** — a `reconcile_gate` step before the `human` skip: read `external-ref`,
  call `gh pr view`, apply the table above via `retag_ticket` / `tk close`, commit, push.
- **Host prerequisite** — `gh` and a GitHub token on the loop host (already needed for the
  agent-land clone; now also for `gh pr view`).

## Risks

- **Stale `external-ref` at a non-gate park** → the check only acts on the two gate phases,
  so a spawn-failure park at `needs-structure` is left alone even though `external-ref`
  still names the merged design PR.
- **`gh pr view` failure (no token, rate limit)** → the check must treat a failed read as
  "stay parked" and log it, never as "merged".
- **Review decision empty** (no review requested) → falls into "anything else", stays
  parked; the human can still merge, which the next tick sees as `MERGED`.
- **Overwriting `external-ref`** loses the design PR number, but structure already consumed
  it from merged `main`; nothing reads it after the design gate.

## ADR pointers

No new ADR. Consistent with [ADR 019](/adrs/019-ticket-layer-git-synced-repo.md) (the
tickets repo is the working queue; `external-ref` is the cross-repo seam) and the domain
boundary (orchestration and gate disciplines are composition outside the engine)[^boundary].
Extends the [ticket layer design](/product/designs/ticket-layer-design.md), whose gates still
assume a human unparks by hand.

## Change set

**This PR (docs, agent-land):** this Design note plus an entry in the designs index.

**After the gate (agent-land-tickets, push-to-main):**

- `scripts/loop.sh` — park with the phase tag kept; add `reconcile_gate` before the `human`
  skip; needs-implementation prompt records `external-ref`.
- `AGENTS.md` — the merge gate is reconciled by the loop; merge or change-request are the
  only two inputs.
- Dogfood — merge a design PR alone and watch the ticket advance, no tag edit.

[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md)
