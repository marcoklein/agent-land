---
type: Reference
title: First ticket-loop run — the loop drives alt-daj9 end-to-end
description: The first `loop.sh` run that advanced a real ticket through the full ladder (research → design → structure → plan → implementation → review fix → close), and the client-auth, timeout, and portability bugs it surfaced.
status: draft
tags: [dogfooding, ticket-loop, orchestration, hitd, scheduler]
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-17T15:11:37Z }
sources:
  - id: loop
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/loop.sh
    title: loop.sh — the ticket-phase driver
  - id: scheduler
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/scheduler.sh
    title: scheduler.sh — the engine-native scheduler the ticket produced
  - id: api
    resource: packages/cli/src/lib/api.ts
    title: al CLI — session create/prompt client and its 30s hard timeout
  - id: ticket
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/.tickets/alt-daj9.md
    title: alt-daj9 — engine-native scheduler ticket
  - id: design
    resource: /product/designs/alt-daj9-engine-native-scheduler-design.md
    title: Engine-native scheduler design note
---

# First ticket-loop run — the loop drives alt-daj9 end-to-end

On 2026-09-17 `loop.sh`[^loop] advanced `alt-daj9` (the engine-native scheduler) through the whole ladder with fresh Luna sessions per phase: `needs-research → needs-design → needs-structure → needs-plan → needs-implementation`, with human gates at design and merge, ending in a closed ticket. The implementation landed as `scripts/scheduler.sh`[^scheduler] in `agent-land-tickets`, pushed straight to main — no `agent-land` PR, because the plan's change set never touched `agent-land`[^ticket].

# What worked

- **Fresh context per phase.** Each tick spawned a new `al run` session pointed at `.tickets/<id>.md` + the ladder artifacts under `work/<id>/`; nothing carried in the agent's context. The loop re-derived state from git every tick, exactly as [the concept](/playbook/ticket-loop.md) promised.
- **Review-feedback reversal.** The first implementation passed the loop's own checks but failed on the laptop (`date -d` is GNU-only). The operator parked it at `human` with review notes and retagged it `needs-implementation`; the next tick's agent read the notes and fixed its own bug. This is the MergeGate → review → fix cycle working without a human touching code.
- **Durable artifacts + audit trail.** Each phase is a commit on main (`loop: claim X`, `loop: phase X -> Y`); the STATUS trail lives in `work/<id>/thoughts.md`.

# Gaps surfaced

1. **`al: run failed: unauthorized` was not GitHub auth.** The laptop loop shell lacked the `AGENT_LAND_*` env vars the `al` CLI needs, so the first several ticks failed identically. Fix: source `agent-land/.env` in the same shell before running the loop, then export `GIT_USER_NAME`/`GIT_USER_EMAIL` explicitly. The GitHub connector was already fine.

2. **A 30s hard timeout in the `al` client.** `packages/cli/src/lib/api.ts` aborts session creation with `AbortSignal.timeout(30_000)`[^api]; on a slow first create it aborts mid-request even though the server proceeds. Transient, but it reads as a failure.

3. **`al: run failed: terminated` can be a lie.** The SSE stream drops while the server-side session keeps working. The loop now re-derives `STATUS:` from `work/<id>/thoughts.md` when work is present despite a client disconnect, instead of treating it as a failed run.

4. **`date -d` is GNU-only and broke macOS tests.** The first `scheduler.sh` used `date -d` for epoch parsing, so `tests/scheduler.test.sh` failed on the dev laptop (BSD `date`). Fixed to `date -r` with a GNU `--date` fallback and `jq fromdateiso8601` for ISO parsing — the review-feedback reversal in action.

5. **The structure agent branched instead of pushing to main.** `agent-land-tickets` is push-to-main, but the agent followed its habit of opening a branch. The implementation prompt now says push-to-main here explicitly; `agent-land` is the only place a PR is opened.

6. **`.env` sourcing quirk.** `agent-land/.env:20` sets `GIT_USER_NAME=Marco Klein` unquoted, so `set -a; . .env` emits `command not found: Klein`. Source with `|| true` and export the name quoted.

7. **Provider switch.** qwencloud quota was exhausted; the loop default moved to `github-copilot/gpt-5.6-luna`, verified with a private-repo clone.

[^loop]: `loop.sh` — ticket-phase driver in `agent-land-tickets`
[^scheduler]: `scheduler.sh` — validate/due/tick, atomic `mkdir` claims, durable run records
[^api]: `packages/cli/src/lib/api.ts`, `AbortSignal.timeout(30_000)`
[^ticket]: `alt-daj9` — engine-native scheduler ticket
[^design]: [Engine-native scheduler design note](/product/designs/alt-daj9-engine-native-scheduler-design.md)
