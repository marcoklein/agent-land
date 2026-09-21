---
type: Design
title: Due-time evaluation and coalescing
description: A schedule is due at a whole minute in its own timezone with a stable run identity; missed minutes fold into one run and replay is bounded by a last-handled marker, never unbounded.
status: draft
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-20T21:28:00Z }
sources:
  - id: parent
    resource: /product/designs/alt-daj9-engine-native-scheduler-design.md
    title: Engine-native scheduler (parent design)
---

# Due-time evaluation and coalescing

## Problem

The scheduler starts one session per schedule whose cron pattern matches the current
minute. Today "due" is a yes-or-no on the exact instant the check runs, so the run name
changes with the second and the same due minute looks like a different run on every check.
When the check does not run for a stretch, missed minutes vanish with no trace and nothing
stops a late check from looking arbitrarily far back.

## Decision requested

1. **Due is the latest matching whole minute at or before now, in the schedule's timezone,
   carried as its epoch minute; the run id hashes the schedule plus that minute.** A skipped
   minute (spring-forward) is never due; an ambiguous minute (fall-back) is due twice.
   *Rejected:* matching the tick's second, which splits one due minute into many run ids.
2. **Missed occurrences fold into one run, not one run each.** Due-time emits the latest
   occurrence since the last handled one plus a `coalesced` count of the missed occurrences
   it covers. *Rejected:* one session per missed minute (unbounded replay).
3. **Replay is bounded by a per-schedule last-handled marker, floored by a fixed lookback
   (default 24 hours).** Only a minute strictly after the reference is due; anything older is
   neither run nor recorded. *Rejected:* deriving the reference from the claims slice's run
   records (circular), and an unbounded backward scan.
