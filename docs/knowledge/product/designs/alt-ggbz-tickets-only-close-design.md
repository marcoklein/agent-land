---
type: Design
title: Implementation gate — close on completion, gate only on a real implementation PR
description: The loop closes a tickets-only implementation on completion and gates only on a pull request the implementation actually opened, so a stale merged design PR can no longer close the ticket.
status: draft
tags: [tickets, hitd, loop, okf]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-21T19:05:00Z }
sources:
  - id: loop
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/loop.sh
    title: Loop driver — reconcile_gate, park, retag
  - id: reconciliation
    resource: /product/designs/alt-sj6u-loop-gate-reconciliation-design.md
    title: Loop gate reconciliation (parent design)
---

## Problem

When the implementation step changes only the tickets repo, it opens no pull request and records nothing, so the ticket's `external-ref` field still names the design pull request, which merged long ago. The loop's reconcile step reads that field at the implementation gate, sees a merged pull request, and closes the ticket. The close rests on the wrong pull request — the design one, not an implementation one — and it fires even when the implementation was blocked or never ran.

## Decision requested

1. **The implementation overwrites `external-ref` on completion.** It writes `gh-<n>` when it opened an agent-land pull request and `none` when the change is tickets-only, so the field states which pull request, if any, the gate must wait on. *Rejected:* a second `impl-ref` field beside `external-ref` (two writers for one fact, more places to drift).

2. **The loop records the design pull request in its own `design-ref` field** when it advances the design gate, so the implementation gate can tell a stale design reference from a fresh implementation one. *Rejected:* leaving no record and treating any merged `external-ref` as the implementation's pull request — the current behaviour that closes blocked or unrun work.

3. **All close logic stays in reconcile.** At the implementation gate it closes when `external-ref` is `none`, closes when the recorded pull request is merged, sends the ticket back on a change request, and leaves a stale or absent reference parked. *Rejected:* closing in `run_tick` the moment the phase reports complete (splits the gate rule and misses blocked or parked cases).
