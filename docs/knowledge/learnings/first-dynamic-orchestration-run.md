---
type: Learning
title: First dynamic-orchestration run (Phase 4)
description: The planner's first real dogfood — it composed a visibly different stage graph than the static default and carried the issue to three green PRs; the plan-comment substitution bug and the Dokku deploy-lock race it surfaced.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-07T20:40:00Z }
tags: [orchestration, planner, dogfooding, multi-agent, phase-4]
sources:
  - id: design
    resource: /product/designs/dynamic-orchestration-design.md
    title: Dynamic Orchestration Design note
  - id: skill
    resource: agent-image/skills/orchestrator/SKILL.md
    title: The planner recipe
  - id: trigger
    resource: .github/workflows/pipeline-trigger.yml
    title: Scheduled pipeline trigger
  - id: deployment
    resource: /learnings/deployment.md
    title: Deployment gotchas
---

# First dynamic-orchestration run (Phase 4)

The planner's first run in anger, on issue #79 ("CLI session observability"). This was the Phase 4 deliverable — a task whose stage graph **visibly differs** from the static default while producing artifacts of matching quality — and it held: the planner composed a graph of `refine → design → implement` and each stage opened a PR that merged green.

## What the planner decided (the deviations)

The default static recipe is `research → refine → design → critic`. The planner deviated on three axes, each grounded in `policy.yaml`[^skill]:

- **skip-research** — the issue was well-specified (outcome + concrete CLI surface + acceptance criteria, and it explicitly named the stage list), which matches the `skip-research` trigger.
- **no critic** — the issue's explicit stage list omitted review, and no `github-ro` connector exists on the platform; the critic stage is "spawned only when the plan calls for it".
- **implement retry capped to 1** — refine+design+implement at 2 attempts each would be 900k worst-case tokens against the 800k `runBudget` ceiling; the `escalateAfter` clause bounds attempts by the aggregate, so 1 attempt → 700k ≤ ceiling. Recorded as a Gate 0 deviation.

It also correctly **declined parallel fan-out**: the two new CLI commands (`al log`, `al status`) touch the same source/test/docs files, which the `parallel` forbid list rules out.

The plan was validated by `plan.mjs` (clean, including `--run-budget`) and posted at Gate 0 before any child spawned.

## What held up under real pressure

- **The three gates stayed human.** Gate 0 (plan), outcome (spec PR #81), design (design PR #82) all parked as `waiting_for_input`; the human `approved` each. Merge (#83) stayed human-gated.
- **Budget accounting worked but revealed a metric trap.** The trace reported `totalTokens` of ~719k/760k/1.97M per stage, which *looks* like it blows the 700k aggregate — but those are cumulative context-token counts, not billable output; the `cost` column ($0.03, $0.04, $0.05 = **$0.11 total** vs $7.00 aggregate) is the reliable signal. Orchestrator-side budget enforcement that keys off `totalTokens` would false-positive; cost (or a provider's output-token field) is the right axis[^design].
- **Execution trace worked.** A JSONL-per-attempt trace (stage, childId, provider, model, budgetUsed, outcome, result, deletedAt) was posted to the issue at run end, so the human saw both the plan and what actually ran.

## Defects found (to fix)

1. **The Gate 0 plan comment posted a literal `$(cat /tmp/plan.json)` instead of the actual JSON.** The orchestrator's `gh issue comment` body is built with a `$(cat <<EOF … EOF)` heredoc; the nested `$(cat /tmp/plan.json)` inside the fenced block never substituted, because the outer `$( )` captures the inner heredoc verbatim. The human could *not* inspect the actual plan JSON at the gate — only the prose deviations, which happened to be enough here. **The plan-comment extension needs to write the plan to a temp file first, or interpolate `$(jq . plan.json)` *outside* the heredoc, so the JSON actually renders.**

2. **The Dokku deploy-lock race.**
   Merging a burst of PRs (e.g. #81/#82/#83 landed back-to-back) fires one Deploy workflow per merge. Dokku allows a single active deploy and rejects concurrent pushes with "agent-land currently has a deploy lock in place". Two of the three deploys failed; the fix was to re-run the workflow manually once the lock cleared. Also note the self-deploy hazard from [self-deploy-hazard](/learnings/self-deploy-hazard.md): the merge that starts the deploy is for the repo the platform itself runs — the re-run pattern (not restart) is what let the dogfood run's platform survive its own merges.

## What to change

- `agent-image/skills/orchestrator/SKILL.md` — fix the plan-comment heredoc so the plan JSON actually renders (defect 1). This is the core recipe bug; the dogfood would have been un-inspectable without the deviations prose.
- `.github/workflows/deploy.yml` — serialize deploys (e.g. a concurrency group on the job, or a short retry/backoff around the `git push dokku`) to make burst merges reliable (defect 2).
- `plan.mjs` / budget accounting — if budget enforcement moves off `totalTokens` to cost, note it in the design-note risk section so the distinction is captured beyond this note.

[^design]: [Dynamic Orchestration Design note](/product/designs/dynamic-orchestration-design.md)
[^skill]: [The planner recipe](agent-image/skills/orchestrator/SKILL.md)
[^trigger]: [Scheduled pipeline trigger](.github/workflows/pipeline-trigger.yml)
[^deployment]: [Deployment gotchas](/learnings/deployment.md)
