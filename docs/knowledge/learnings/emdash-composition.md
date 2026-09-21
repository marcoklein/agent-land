---
type: Reference
title: Agent Land and Emdash — how they compose
description: Emdash is a desktop cockpit for running agents; Agent Land is a headless runtime. They share the skills standard and overlap on scheduling.
status: draft
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-21T00:00:00Z }
sources:
  - id: emdash-overview
    resource: https://emdash.com/docs
    title: Emdash overview — Open Source Agentic Development Environment
    last_modified: 2026-09-21
  - id: emdash-automations
    resource: https://emdash.com/docs/automations
    title: Emdash Automations — schedule recurring tasks
    last_modified: 2026-09-21
  - id: emdash-skills
    resource: https://emdash.com/docs/library/skills
    title: Emdash Skills — Agent Skills standard, sync targets
    last_modified: 2026-09-21
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
---

# Agent Land and Emdash — how they compose

# Working rule

**Emdash is a human cockpit; Agent Land is a headless runtime. They compose at the skills layer — Emdash installs `SKILL.md` modules to the same `~/.config/opencode/skills/` directory the loop's OpenCode sessions load — and they overlap on scheduling: Emdash Automations are a GUI-bound, fire-and-forget version of the engine-native scheduler the loop is building.**

| Layer | Emdash owns | Agent Land owns |
|---|---|---|
| Control flow | Automations cron, prompt + provider + workspace | Ticket ladder, phase state machine, gate reconciliation |
| Execution | Agent CLI in a git worktree, GUI-triggered | Headless session via JSON/SSE (curl/bash, host cron) |
| Capabilities | Skills (`SKILL.md`), prompts, MCP from the Library | Skills, sealed connectors, mounts |
| Observation | Run history, diff view, CI checks, in-app browser | Append-only event stream, ticket state in the queue repo |
| Scheduling | Automations — self-healing, run lifecycle, "run now" | Engine-native scheduler (`alt-nrs3`, in progress) |
| Interface | Desktop app, no headless API | Headless host, no GUI |

# Concrete composition

The one real integration point is **skills sync**. Emdash follows the open [Agent Skills](https://agentskills.io/home) standard and, on install, symlinks each skill into the agent's config directory — for OpenCode that is `~/.config/opencode/skills/<skill>/`[^emdash-skills]. That is the same user-level directory the loop's OpenCode sessions read, so a skill installed through Emdash's catalog (OpenAI or Anthropic libraries) is immediately available to a session the loop launches — no copy, no rebuild. The reverse also holds: Agent Land's own skills live in the same format and could be browsed or edited in Emdash.

The second, read-only use is **prior art for the scheduler epic**. Emdash Automations already implement what `alt-nrs3` is building: a cron trigger, a run lifecycle (`scheduled → queued → creating_task → launching_task → creating_conversation → done/failed/skipped`), a self-healing scheduler that keeps exactly one upcoming run and recovers across restarts, and a full run history with status, timing, trigger, and error[^emdash-automations]. That maps onto the due-time, atomic-claims, and run-record slices (`alt-nlby`, `alt-667q`) as a proven reference — not a dependency.

# When they overlap instead of compose

They are substitutes in one dimension: both schedule and launch agent runs. But Emdash Automations are prompt-driven and fire-and-forget — there is no ticket state, no phase ladder, no merge-and-change-request gate reconciliation — and Emdash is a local desktop app with no headless API, so the loop cannot drive it and it cannot run the loop[^emdash-overview]. Keep the loop for the ticket-driven workflow; reach for Emdash only as a human's review window (diff view, CI checks, PR review) or a source of skills. For "run a recurring prompt and collect the diff", Emdash alone is enough; Agent Land earns its place when the run needs a state machine, sealed capabilities, or an unattended host.

[^emdash-overview]: Emdash overview, https://emdash.com/docs
[^emdash-automations]: Emdash Automations, https://emdash.com/docs/automations
[^emdash-skills]: Emdash Skills, https://emdash.com/docs/library/skills
