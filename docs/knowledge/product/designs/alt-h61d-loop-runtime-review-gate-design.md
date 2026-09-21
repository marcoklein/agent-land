---
type: Design
title: Ticket driver's own code needs a review gate
description: Changes to the scripts that run the ticket driver go through a pull request review; direct pushes stay only for tickets and state.
status: draft
tags: [tickets, hitd, loop, okf]
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-21T19:21:36Z }
---

# Ticket driver's own code needs a review gate

## Problem

An automated driver works this project's ticket queue and commits its changes straight to
the main branch with no human looking first. The same commit can change the scripts that
run the driver itself, so the automation can rewrite the code that runs it, and a broken
change takes effect unseen. A rework of those scripts is about to touch them heavily. The
question is whether such changes must pass a human review before they land.

## Decision requested

1. **Review changes to the driver's own code; stop pushing them unreviewed.** Any change
   to those scripts must pass a human review before it runs. *Rejected:* today's behaviour
   — commit straight to main, no review.
2. **The reviewed set is the code the driver runs, not the data it writes.** That is the
   scheduler, the driver loop, the schedule validator, and the ticket command the driver
   runs on every tick. *Rejected:* also reviewing everything the driver writes (tickets,
   board state, run records) — that is data, and reviewing it would stall ordinary work.
3. **The gate is a pull request, not a direct push.** When a change touches that code, the
   driver opens a pull request and a human merges it; direct pushes stay only for tickets
   and state. *Rejected:* moving that code into the agent-land repository — the driver runs
   from this repo's checkout, and relocating it breaks the host timer path.
