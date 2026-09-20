---
type: Design
title: Due-time evaluation and coalescing
description: A schedule is due at a whole minute in its own timezone with a stable run identity; missed minutes fold into one run and replay is bounded by a last-handled marker, never unbounded.
status: draft
tags: [scheduler, hitd, loop, okf]
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-20T21:28:00Z }
sources:
  - id: parent
    resource: /product/designs/alt-daj9-engine-native-scheduler-design.md
    title: Engine-native scheduler (parent design)
  - id: loader
    resource: /product/designs/alt-jp4q-schedule-contract-loader-design.md
    title: Schedule contract and loader
---

# Due-time evaluation and coalescing

## Problem

The scheduler starts one session per schedule whose time pattern matches the current
minute. Today "due" is a yes-or-no on the exact moment the check runs: the run's name is
built from the schedule plus that instant, seconds included, so the same due minute looks
like a different run on every check, and a retry looks like a new run. When the check does
not run for a stretch — the machine asleep or down — the missed minutes are dropped with no
trace: the next check fires only if it happens to land on a matching minute, nothing
records that minutes were missed, and nothing stops a late check from looking arbitrarily
far back. The scheduler should treat "due" as a real, identified moment and turn "missed
minutes vanish" into one coalesced run with a bound.

## Decision requested

1. **Due is the latest matching whole minute at or before now, in the schedule's timezone,
   carried as its epoch minute; the run id hashes the schedule plus that minute.** A skipped
   minute (spring-forward) is never due; an ambiguous minute (fall-back) is due twice, once
   per instant. *Rejected:* matching the tick's second and hashing that instant, today's
   behaviour, which splits one due minute into many run ids and makes a retry a new run.
2. **Missed occurrences fold into one run, not one run each.** Due-time emits the latest
   occurrence since the last handled one and a `coalesced` count of the earlier missed
   occurrences it covers; the run kernel records that count so the drop is visible, not
   silent. *Rejected:* one session per missed minute (unbounded replay), and a missed-marker
   file per occurrence (state that grows with the outage).
3. **"Never replay without bound" is a per-schedule last-handled marker owned by due-time,
   floored by a fixed lookback (default 24 hours).** Due-time looks only for occurrences
   after the marker, so one occurrence is never emitted twice; with no marker, the search
   stops at the floor and anything older is neither run nor recorded. *Rejected:* deriving
   the reference from the claims slice's run records (circular — those records are keyed by
   the run id this slice defines), and an unbounded backward scan.

## Approach

Due-time is one command in the tickets repo, consuming the loader's normalized schedule
list (reading only `cron`, `timezone`, `enabled`) and returning at most one due item per
schedule. It never launches a session and never changes the engine.

**The occurrence.** For a schedule and a "now", due-time truncates now to the minute and
steps backward sixty seconds at a time, asking the operating system for the five local
fields under the schedule's timezone. The first minute whose fields match the five pattern
fields is the occurrence, returned as its epoch minute (UTC, zero seconds). Stepping the
instant rather than the wall clock makes daylight saving fall out correctly: a skipped
minute produces no instant and is never due; an ambiguous minute produces two instants and
is due twice, each with its own run id.

**The identity.** The run id is the first 16 characters of a hash of the schedule id plus
the epoch minute. The claims slice consumes this id unchanged, and the planned time it
records is the epoch minute, not the tick instant.

**The search and its bound.** The search stops at a reference — the later of the schedule's
last-handled marker and `now − 24h` — and only a minute strictly after the reference is
due. The marker advances only when the occurrence is actually launched, through a
`mark-handled` operation the run kernel calls; if a launch fails, the marker stays put and
the next tick sees the same occurrence again (at-least-once). A minute older than the
reference is neither run nor recorded, which is what bounds replay.

**Coalescing.** Only the latest matching minute is emitted. Every matching minute the
search passes over between the reference and that latest one is missed — not run, not
individually recorded — and the emitted item carries their count as `coalesced`.

## Interfaces

| Operation | Input | Output |
|---|---|---|
| due | schedule list, now (UTC) | `{scheduleId, plannedAt, runId, coalesced}` or nothing |
| mark-handled | scheduleId, epoch minute | advances that schedule's last-handled marker |

- `plannedAt` is the occurrence's epoch minute (UTC, zero seconds) — the planned start the
  run record stores; `runId` is stable for that minute. State: a per-schedule `last-handled`
  marker under the scheduler's state directory, not committed and not shared across hosts.

## Risks

- **A launch fails and the marker does not advance** → the same occurrence is re-emitted
  next tick with the same run id; the claim/record dedupes, so the retry is the same run.
- **The lookback drops a sparse schedule's run** → a minute older than 24 hours is out of
  scope by design; the operator tunes the floor, and the bound is the point of the rule.
- **Cron `0` for Sunday** → normalized to match `%u`=7, so a `0` day-of-week no longer
  silently never fires.

## ADR pointers

No new ADR. Follows the domain boundary (scheduling is composition outside the engine) and
the parent [engine-native scheduler design](/product/designs/alt-daj9-engine-native-scheduler-design.md),
whose "missed laptop intervals" mitigation this note turns into a rule. The
[loader](/product/designs/alt-jp4q-schedule-contract-loader-design.md) supplies the fields it
reads; the claims/records slice (`alt-667q`) consumes the run id and planned time unchanged.

## Change set

**This PR (docs, agent-land):** this Design note plus an entry in the designs index.

**After the gate (agent-land-tickets, push-to-main):**

- `scripts/scheduler.sh` — `due` computes the occurrence, its stable run id, and the
  `coalesced` count against the last-handled marker and lookback floor; `mark-handled`
  advances the marker.
- Tests: two ticks in one due minute share a run id; different minutes differ; a pattern
  matches or not across a daylight-saving boundary; N missed minutes yield one item with
  `coalesced` N−1; a minute older than the bound is neither run nor recorded.
