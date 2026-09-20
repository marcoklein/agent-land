---
status: proposed
date: 2026-09-20
tags: [loop, tickets, verification, state]
deciders: [agent]
---

# Verify Loop Phase Completion from Artifacts, Not Self-Reported Status

**Decision:** The loop re-derives a ticket's phase completion from durable, checkable facts — the phase's artifact file exists *and* its own `HITD_HANDOFF_V1` block reports `STATUS: COMPLETED` — and never advances on a bare `STATUS:` string or a missing handoff; a tick also holds a `flock` mutex so a slow phase never races a second driver.

**Why:** Trusting the agent's self-reported `STATUS` (read as the last line of `thoughts.md`) let a phase with no handoff inherit the previous phase's `COMPLETED`, advancing `alt-g1f1` to the merge gate with an incomplete implementation — state corruption the loop could not see.

**Alternatives considered:** a label/`STATUS`-string state machine (rejected — self-reported, drifts from artifacts); trusting the last `STATUS:` line (rejected — reads the previous phase's result); no mutex (rejected — `LOOP_TIMEOUT_SEC` > cron interval races two drivers on git).
