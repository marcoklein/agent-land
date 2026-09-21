---
type: Design
title: Atomic claims and durable run records
description: A claim only one scheduler pass can win, and a run record written at launch and completed at settle, so a schedule never starts twice and the outcome survives a crash.
status: draft
generated: { by: pi/deepseek-v4-pro, at: 2026-09-20T21:06:27Z }
sources:
  - id: parent
    resource: /product/designs/alt-daj9-engine-native-scheduler-design.md
    title: Engine-native scheduler (parent design)
---

# Atomic claims and durable run records

## Problem

The scheduler starts one session whenever a schedule comes due. Two passes can overlap and
both may start the same schedule twice; there must be one winner. And after a run ends,
there must be a record of when it was planned and started, which session it used, and how it
ended. Today both are rough: the overlap guard is a lock never freed on a crash, so the
schedule stays stuck until a human clears it, and the record is written once at launch and
never updated, so the outcome is lost.

## Decision requested

1. **The claim is a directory per schedule, created in one step so only one pass can win,
   holding the run's identity and expiry; release removes only the directory whose stored
   identity matches the one held.** The run identity is stable for one due occurrence, so a
   retried pass is the same run. *Rejected:* the deployed loop's single shared lock file.
2. **The record is one file per run, written at launch and completed at settle with the
   final status, finish time, and failure reason; rewriting the same run writes the same
   content, and no record is ever deleted.** *Rejected:* first-write-wins, which silently
   drops the settle update.
3. **Reconciliation: a claim past its expiry (creation plus the schedule's timeout) is
   checked against the platform session state — "stopped" or not found frees the claim,
   "running" or "waiting for input" leaves it alone.** *Rejected:* leaving expired claims
   for a human.
