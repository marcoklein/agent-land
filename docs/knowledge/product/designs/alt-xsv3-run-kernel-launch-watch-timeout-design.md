---
type: Design
title: Launch, wait, and stop one scheduled run
description: One slice turns a due, claimed run into a launched session, waits for the platform's settle event, and stops it past the deadline, relying on the engine for the mount rule.
status: draft
tags: [scheduler, hitd, loop, okf]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-21T22:52:37Z }
sources:
  - id: parent
    resource: /product/designs/alt-daj9-engine-native-scheduler-design.md
    title: Engine-native scheduler (parent design)
---

# Launch, wait, and stop one scheduled run

## Problem

The scheduler turns a due, claimed run into a real session, then waits for it to finish and
stops it if it runs too long. Today that code is inline in the loop's tick step, mixed with
claiming and recording. Its "finished" check matches a hand-written list of words the
platform never sends, so a finished session can be reported as timed out; its launch sends a
parent field and a mount shape the platform does not use; and the one-session-per-mount rule
is a separate check that guesses the session-list shape and can disagree with what launch
does.

## Decision requested

1. **Launch posts the loaded schedule's selection, and a busy mount is the engine's refusal,
   not a kernel check.** The request is `platform: true`, connector names, `{source, target}`
   mount binds, provider, and model, with the parent recorded as `parentSessionId` and the
   session id read from the response. A mount already held by a live session makes the engine
   reject the launch with `MountInUseError`, recorded as a skipped run with the claim freed.
   *Rejected:* today's inline launch and mount check, which re-reads the raw config, sends
   mounts as name strings, sends `parentSession`, and guesses the session-list shape.
2. **Finished means the platform's "agent finished and is idle" event, not a guessed status
   word.** The wait step reads the session's event stream from the start so a fast finish is
   not missed, and returns on `agent_settled`, with the session's recorded status as a
   fallback. *Rejected:* polling the status text against a hand-written word list the
   platform never emits.
3. **Timeout counts from launch and ends with the kill-and-remove call.** The deadline is
   session creation plus the schedule's timeout; past it, the kernel calls the platform's
   delete-session endpoint and records the run as timed out. *Rejected:* counting from the
   claim's start, before launch, and aborting the current turn, which leaves the session
   alive.
