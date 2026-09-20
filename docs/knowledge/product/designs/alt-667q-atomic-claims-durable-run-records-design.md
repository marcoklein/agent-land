---
type: Design
title: Atomic claims and durable run records
description: A claim only one scheduler pass can win, and a run record written at launch and completed at settle, so a schedule never starts twice and the outcome survives a crash.
status: draft
tags: [scheduler, hitd, loop, okf]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-20T21:06:27Z }
sources:
  - id: parent
    resource: /product/designs/alt-daj9-engine-native-scheduler-design.md
    title: Engine-native scheduler (parent design)
  - id: scheduler
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/scheduler.sh
    title: Current scheduler — claim, record, launch, watch
  - id: session
    resource: packages/contracts/src/session.ts
    title: Session statuses and envelope shape
---

# Atomic claims and durable run records

## Problem

The operator runs a scheduler that starts one agent session whenever a schedule comes due.
Before it can run unattended, two things must be reliable. Two passes can overlap — a slow
run crossing into the next — and both may decide the same schedule is due, starting two
sessions; there must be one winner. And after a run ends, the operator needs a record of
what happened: when it was planned, when it actually started, which session it used, how
it ended, and why. Today both are rough code in one script: the overlap guard is a lock
never freed on a crash, so the schedule stays stuck until a human clears it by hand, and
the record is written once at launch and never updated, so the outcome is lost.

## Decision requested

1. **The claim is a directory per schedule, created in one step so only one pass can win,
   holding the run's identity and its expiry; release removes only the directory whose
   stored identity matches the one the process holds.** The run identity is stable for one
   due occurrence, so a retried pass is the same run, not a new one. *Rejected:* the
   deployed loop's single shared lock file, and a release that deletes without checking
   (which could free a newer claim).
2. **The record is one file per run, written at launch — planned start, actual start,
   session id, "started" — then completed at settle with the final status, finish time, and
   failure reason; rewriting the same run writes the same content, so retries are
   harmless, and no record is ever deleted.** *Rejected:* today's first-write-wins, which
   silently drops the settle update, and one log shared by every run, which is harder to
   find and reconcile.
3. **Reconciliation: a claim's expiry is its creation time plus the schedule's timeout;
   when a later pass finds a claim past its expiry, it asks the platform for the recorded
   session's state — "stopped" or not found frees the claim, "running", "waiting for
   input", or "idle" leaves it alone.** *Rejected:* leaving expired claims for a human, and
   treating "idle" as finished when it is still a live session.

## Approach

The slice is four operations in the tickets repo replacing the claim and record code in the
current scheduler script. None decides what is due or launches a session.

**Claim.** A directory named after the schedule, created with `mkdir`, which hands it to
exactly one caller; the loser gets an error and is skipped. A file inside stores the run
identity and the expiry (creation time plus the schedule's timeout). The session id is not
stored here; it lands in the run record at launch, where reconciliation reads it.

**Record.** One file per run, keyed by schedule id and run id in the path, written by
writing a temp file and renaming it into place, so a crash mid-write leaves the previous
complete file. Launch writes planned start, actual start, session id, "started"; settle
rewrites the whole file with final status, finish time, and failure reason. The same run
always produces the same content, so a retried write changes nothing. Records are never
deleted or re-keyed — the set only grows, which is the "append-only" guarantee.

**Release.** After a run settles — success, failure, or a launch that never started — the
holder removes the claim directory after confirming the stored identity is its own. That
makes release safe to run twice and stops a stale pass from freeing a newer claim.

**Reconcile.** A pass that finds an existing claim compares the stored expiry to now. Not
expired: skip. Expired: read the session id from the run record, ask the platform for that
session's state, and free the claim only if the session is "stopped" or not found. A crash
blocks a schedule for at most one timeout, not until a human intervenes.

## Interfaces

| Operation | Input | Output |
|---|---|---|
| claim | schedule id, run id, timeout | winner, or skipped |
| record | schedule id, run id, fields | file written; retry is a no-op |
| release | schedule id, run id | claim removed if identity matches |
| reconcile | schedule id, current time | freed, or left alone |

- Run record fields: planned start, actual start, session id, status, finish time, failure
  reason. The path carries both the schedule id and the run id.
- Session state is read with `GET /api/sessions/:id`: "stopped" or not found is finished;
  "running", "waiting for input", and "idle" are live.
- Claims are filesystem state in the scheduler's checkout, not committed; run records are
  committed to the ticket repo. A claim guards one checkout, not multiple hosts.

## Risks

- **A stale pass deletes a live claim** → release checks the stored identity, so only the holder frees its own claim.
- **A crash between claim and record** → the claim expires; reconciliation finds no session to protect and frees it, so the next due run starts late.
- **`idle` treated as finished** → an idle session can resume, so it counts as live; the tests pin this.
- **Two checkouts, one schedule** → a claim is per checkout, not cross-host, so a host running two clones can double-start; documented, not solved.
- **Records grow without bound** → acceptable now; compaction is out of scope and does not change the contract.

## ADR pointers

No new ADR. Follows the domain boundary (scheduling is composition outside the engine) and
the parent [engine-native scheduler design](/product/designs/alt-daj9-engine-native-scheduler-design.md),
which this note turns into tested primitives. The [loader](/product/designs/alt-jp4q-schedule-contract-loader-design.md)
supplies the schedule id, timeout, and concurrency these primitives read.

## Change set

**This PR (docs, agent-land):** this Design note plus an entry in the designs index.

**After the gate (agent-land-tickets, push-to-main):**

- A claims/records module replacing the claim and record code in `scripts/scheduler.sh`.
- Tests: two overlapping claims have one winner; a stale claim with a finished or gone
  session is freed; a stale claim with a live session is left; a retried write of the same
  run is a no-op; release is safe to run twice.
