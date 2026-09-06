---
type: Reference
title: First end-to-end pipeline run — label to merged product memory
description: The first fully automated product-pipeline run (issue #57 → spec/design/close PRs merged), what the orchestrator and its children got wrong at each stage transition, and the master-session interventions that kept it moving.
status: draft
tags: [orchestration, pipeline, dogfooding, gates, critic, learnings]
generated: { by: opencode/qwen3.8-max, at: 2026-09-06T01:00:00Z }
sources:
  - id: orchestrated
    resource: /learnings/first-orchestrated-run.md
    title: First orchestrated run
  - id: roadmap
    resource: /multi-agent-workflow.md
    title: Multi-agent workflow roadmap
  - id: skill
    resource: agent-image/skills/orchestrator/SKILL.md
    title: The static orchestrator recipe
  - id: trigger
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger
---

# First end-to-end pipeline run — label to merged product memory

On 2026-09-05/06 the whole stack ran in anger for the first time: issue #57 got the `pipeline-ready` label → the [pipeline trigger](/learnings/scheduled-pipeline-trigger.md) workflow spawned an orchestrator session → research, refine, design, critic, and close children ran in sequence → **spec PR #65, design PR #67, and close PR #68 all merged**, and the feature note was promoted `draft → stable` with a real critic-driven revision loop in between. The human role was exactly the designed one: gate decisions and merge — everything else was agents.

The composition-level lessons live in [first orchestrated run](/learnings/first-orchestrated-run.md). These are the *pipeline-run* lessons, stage by stage.

## 1. Every stage transition is a stall opportunity

The orchestrator stalled **three times** in one run — after the research child settled (watch-loop hang), mid-design (silent settle inside a long bash call), and at the close stage (turn ended while watching). Each recovered with one steering prompt. The pattern that always worked:

1. State what the orchestrator failed to notice ("your child settled WITHOUT opening a PR; I deleted it; the Mount is free").
2. Enumerate the remaining steps as numbered commands.
3. End with "do not end a turn until step N is done."

Implication for Phase 4: **stall detection belongs in the recipe** — a watchdog rule ("if a stage bash call exceeds X minutes or the child is settled but the expected artifact is missing, recover") rather than operator reflexes. The expected-artifact check (PR URL exists? comment posted?) is the reliable completion signal, not `agent_settled`.

## 2. The watch-loop hang was the skill's bug, and the fix is merged

`curl | jq | while-read` pipelines that `break` on the settle marker still hang: curl dies only on SIGPIPE, which needs a *write*, and a settled child writes nothing more. Every stage blocked until the child was deleted (deletion emits `status: stopped`, which finally kills the pipeline). Fixed in the skill (PR #66): background curl into a capture file, poll the file for the marker, `kill` curl explicitly. The same PR fixed `spawn_child` string-concatenation (a live run shipped the literal `$CONNECTOR_NAME`, silently yielding a child with no GitHub env) by building create-JSON with `jq -n --arg`, and added `export GH_TOKEN="$GITHUB_TOKEN"` to every child prompt — the image's `gh` did not authenticate from `GITHUB_TOKEN` alone.

## 3. The critic stage earns its keep

Round 1 found six concrete defects in the design note — including a **factually wrong claim** that ADR 011's kill-switch enforcement already exists (the critic verified against server code: only `abort()`/`kill()` are implemented) and a missing per-child Mount GC lifecycle. The gate-2 feedback loop ("revise per critic report") produced a revision that round 2 verified finding-by-finding, leaving one arithmetic error (`aggregateBudget.maxTokens` 580000 vs the note's own formula yielding 540000). An adversarial reviewer child that checks claims **against the actual repo** caught what the design child asserted — this is the strongest argument so far for the trust-ladder placement: critic advises, human (or delegated master session) decides.

## 4. Gates work as park-and-re-prompt, and delegation works

Each gate behaved as designed: the orchestrator ended its turn with one question and created no more children; a re-prompt carrying `approved` / `feedback: …` resumed it correctly, including re-running a stage after feedback. When the operator delegates gate authority to a master session (as here), the master session must still **verify the artifact before approving** — it reviewed each PR diff, applied the round-2 critic fixes directly when they were trivial, and merged. The gates degraded to checkpoints, not rubber stamps.

## 5. Small things that bit

- **Steering prompts with nested shell quoting fail as HTTP 400** ("Bad Request" HTML from express) — build prompt JSON with `jq -n --arg` or a real serializer, never shell interpolation.
- **Idle ≠ done.** A child can sit `idle` having settled mid-task with no artifact; check the deliverable, not the status.
- **The orchestrator loses nothing by session deletion mid-run** — gate state lived in `/tmp` files inside its container *and* in issue comments; after a stall recovery it correctly re-derived state from the issue + PR facts. Durable state on the issue (comments as the record) is what made every recovery possible.
