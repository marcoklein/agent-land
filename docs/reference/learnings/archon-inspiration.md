---
type: Reference
title: Inspiration from Archon
description: What agent-land can selectively borrow from Archon's workflow-engine approach — and what to deliberately refuse.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-01T00:00:00Z }
sources:
  - id: archon-readme
    resource: https://github.com/coleam00/archon
    title: Archon README (dev branch)
    author: coleam00
    last_modified: 2026-09-01
  - id: archon-ai-assistants
    resource: https://archon.diy/getting-started/ai-assistants/
    title: Archon docs — AI Assistants (Claude, Codex, OpenCode, Pi, Copilot)
    last_modified: 2026-09-01
  - id: engine
    resource: /reference/engine.md
    title: Agent Land engine — the purest form
---

# Inspiration from Archon

# Working rule

**Borrow Archon's recipe-side ideas — isolation, portability, approval gates, capability declarations. Refuse everything that puts orchestration or presentation inside the engine.**

Archon is the mirror image of agent-land. It solves "every run is different" with a built-in YAML workflow engine: DAG nodes (`prompt`, `bash`, `loop`, `approve`), per-run git worktree isolation, 19 bundled workflows, a web UI and chat adapters — all in-core.[^archon-readme] Agent Land solves the same problem with six primitives and orchestration outside the engine.[^engine] The comparison clarifies what agent-land should borrow (concrete technique) versus refuse (platform scope).

# Ideas worth taking

| # | Archon idea | Agent Land translation | Actionability |
|---|---|---|---|
| 1 | Per-run **git worktree isolation** — parallel runs never conflict[^archon-readme] | Mount (roadmap) hosts the durable checkout; each *run* gets a disposable worktree/branch on that Mount. Cheaper than a fresh container filesystem, still conflict-free parallel runs | feeds Mount design |
| 2 | **Portable recipes**: workflows committed to the repo, same behavior on every surface; user-level overrides under `~/.archon/`[^archon-readme] | Recipe convention: discoverable recipe files (repo-local, user-level override). Recipes stay outside the engine but get a portable home | new convention, no engine change — see the [product pipeline](/reference/product/pipeline.md) for the first realization |
| 3 | **Approval gates** as first-class steps: `interactive: true` loop pauses for a human approve[^archon-readme] | Maps 1:1 to the existing `waiting_for_input` state + manual permission policy. Recipe pattern: run until `waiting_for_input`, human resolves, run continues. At most a tiny CLI affordance (`al resolve`) | mostly documentation |
| 4 | **Deterministic/AI mix**: bash and validation nodes are deterministic; AI only runs where it adds value[^archon-readme] | Recipe discipline: typecheck, tests, git steps as plain commands between sessions; AI only at decision points | discipline |
| 5 | **Capability declarations → generated matrix**: the provider capability matrix is generated from provider capability declarations, so docs never drift[^archon-ai-assistants] | Providers/models could carry capability flags (structured output, tools, session resume); `al models` renders them instead of a hand-maintained table | small schema extension |
| 6 | **Fail-loud structured output**: nodes declare `output_format`, parsed output is schema-validated, the node fails rather than degrading[^archon-ai-assistants] | Agent Land already does this at API boundaries (zod contracts). Extend the discipline into recipes: recipe step outputs are parsed and validated, or the run fails loudly | discipline |
| 7 | **Docs culture**: narrative 10-chapter book + `llms.txt` index for AI tools[^archon-readme] | Add an `llms.txt` to docs; keep the "what it is and is not" page pattern | cheap |
| 8 | **Telemetry posture** — if ever needed: categorical-only, never content, `DO_NOT_TRACK` honored, CI auto-disabled[^archon-readme] | Deferred. If agent-land ever ships telemetry, copy this posture | defer |

# Confirmation of Agent Land's model

- Archon drives five assistants (Claude, Codex, OpenCode, Pi, Copilot) through one provider seam, with community providers registered as `builtIn: false`[^archon-ai-assistants] — validates Agent Land's generic provider records over vendor catalogs.
- `fresh_context: true` loop iterations spawn fresh sessions[^archon-readme] — validates transient sessions as the composition unit.
- Archon's OpenCode/Pi integration spawns the agent per run, feeds prompts, streams events — Agent Land's pi-in-a-container model minus the container.

# Deliberately refused

| Archon feature | Why Agent Land refuses it |
|---|---|
| Workflow executor in-core (DAG nodes, loops, router) | Orchestration is a recipe concern, not an engine primitive[^engine] |
| 19 bundled workflows | Process knowledge baked into the platform — the opposite of generic primitives |
| Web UI (dashboard, drag-drop builder) + Slack/Telegram/Discord adapters | Presentation belongs outside; the JSON/SSE API is the only surface (stripped in PR #38) |
| SQLite/Postgres, 14 tables, multi-user auth | Flat JSON + event logs suffice for a single-operator engine |
| Telemetry on by default | No telemetry. See idea #8 for the if-ever posture |

[^archon-readme]: Archon README (dev branch), https://github.com/coleam00/archon
[^archon-ai-assistants]: Archon docs — AI Assistants, https://archon.diy/getting-started/ai-assistants/
[^engine]: `docs/reference/engine.md` — six primitives, three substrates, one engine opinion
