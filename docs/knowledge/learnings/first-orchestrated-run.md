---
type: Reference
title: First orchestrated run — phases 1–3 executed by platform sessions
description: How the multi-agent roadmap's first three phases were built by agent-land sessions driven from a master session, and what stalled, broke, or needed a human-token escape hatch on the way.
status: draft
tags: [orchestration, dogfooding, sessions, github-token, learnings]
generated: { by: opencode/qwen3.8-max, at: 2026-09-05T16:35:00Z }
sources:
  - id: roadmap
    resource: /multi-agent-workflow.md
    title: Multi-agent workflow roadmap
  - id: loopback
    resource: /learnings/first-loopback-run.md
    title: First loopback run
  - id: trigger
    resource: /learnings/scheduled-pipeline-trigger.md
    title: Scheduled pipeline trigger
---

# First orchestrated run — phases 1–3 executed by platform sessions

On 2026-09-05 a master session (opencode on the operator's laptop) acted as the orchestrator for [the roadmap](/multi-agent-workflow.md)'s first three phases: it spawned one `al run` session per phase against the hosted platform, watched them via `al ls --tree` / `al log`, verified their PRs in a local git worktree, merged them, and re-prompted them when they stalled. Results: Platform Connector (#58), orchestrator skill (#62), pipeline trigger (#63) — all produced by platform sessions, all live.

The loopback-specific findings live in [first loopback run](/learnings/first-loopback-run.md). These are the *orchestration* findings — what a master session must expect when driving worker sessions.

## 1. Sessions stall mid-task; the orchestrator's job is the re-prompt

Twice in one run a worker session settled without finishing:

- The Phase 2 session stopped after its file edits, before commit/push/PR — mid-recipe, no error, status `idle`.
- The Phase 3 session read its environment, decided it lacked platform injection (irrelevant to its task), and parked with a clarifying question: "Which is it?"

Both recovered with a single re-prompt. What worked:

- **Enumerate the remaining steps as numbered shell commands** ("1) git status 2) pnpm test 3) commit … 7) report the PR URL") — vaguer "please continue" prompts risk another stall.
- **End with an explicit completion condition**: "Do not stop until the PR is green and the issue comment is posted."
- **Preempt misreadings**: the Phase 3 agent confused *implementing* the trigger with *being run by* the trigger. Task prompts should state what the session is NOT doing when the context makes confusion likely.

An autonomous orchestrator (Phase 2's recipe, Phase 4's planner) must treat `agent_settled` as "turn done", never "task done" — completion is verified against the deliverable (PR exists, CI green), not the settle event.

## 2. The GitHub connector token can't push workflow files — escape hatch: patch extraction

The Phase 3 session did all the work, committed on its branch **inside its container**, and then hit a wall: `gh` refused the push because `.github/workflows/*` changes require a token with the **Workflows** permission, which the connector's PAT lacks. The session correctly refused to open a partial PR and settled.

Recovery without re-running anything — the commit still lived in the session's container:

```bash
ssh <host> "sudo docker exec agent-land-pi-<session-id> \
  sh -c 'cd /workspace/agent-land && git format-patch -1 --stdout'" > /tmp/task.patch
# then locally: git checkout -b <branch> && git am /tmp/task.patch
```

The master session applied the patch, fixed the connector-name bug it found while verifying, and landed the PR itself. **Durable fix:** give the connector token `Workflows: write` (or keep workflow-file changes a master-session/human task). Until then, any task touching `.github/workflows/` will stall at push.

## 3. Verification is the orchestrator's most valuable step

Every worker PR needed master-session correction before merge:

- **Phase 2 (#62):** branch cut from a stale main would have reverted two just-merged PRs (learnings note + `.gitignore` entry) — caught by diffing against current main, fixed by merging main into the branch. The agent had also `git add -A`'d the untracked `thoughts/` scratch files.
- **Phase 3 (#63):** the workflow and both bundled skills hardcoded `"connectors": ["github"]`, but connectors resolve by **exact name** and the real connector is `GitHub Personal All Repos` — every spawned child would have silently gotten *no* GitHub credentials. Fixed by discovering the connector via `GET /api/connectors` (first entry whose `envKeys` include `GITHUB_TOKEN`).

Pattern: worker sessions verify against *their clone's* main and against *assumed* platform state; the orchestrator verifies against *actual current* main and *actual live* API responses. Both checks are cheap (`git diff origin/main --stat`, one curl) and caught every regression of this run.

## 4. Operational notes for the master session

- **One worker at a time** kept verification tractable and avoided branch collisions; the roadmap's sequential discipline applies to the orchestrator itself, not just its children.
- **Watch loop:** `al ls --tree` for lineage/status, `al log <id> | tail` for progress, `gh pr list --head <branch>` for the deliverable. The event history replay (`GET /api/sessions/:id/events`) is the post-mortem when a session stalls.
- **Agent-image rebuilds make the first session create slow** — a client-side `al run` timeout does not kill the server-side session; check `al ls` and re-prompt the orphan instead of re-running (see [first loopback run](/learnings/first-loopback-run.md)).
- **Merging a worker PR redeploys the platform under the master session's feet** ([self-deploy hazard](/learnings/self-deploy-hazard.md)) — idle sessions survived two redeploys in this run and re-attached cleanly.
