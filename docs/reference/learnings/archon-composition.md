---
type: Reference
title: Agent Land and Archon — how they compose
description: Archon is a recipe layer; Agent Land is a runtime. Where they compose, and where they overlap.
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

# Agent Land and Archon — how they compose

# Working rule

**Archon is a recipe layer; Agent Land is a runtime. They compose when an Archon workflow shells out to `al` for its AI steps — Archon supplies the deterministic DAG, loops, and human gates, while Agent Land supplies container isolation, sealed capability injection, and the event stream.**

Both drive the same agent (pi), so the split is not "different agents" but "different layers":

| Layer | Archon owns | Agent Land owns |
|---|---|---|
| Control flow | YAML DAG, `loop`, `approve`, routing, worktree isolation[^archon-readme] | Nothing — deliberately external[^engine] |
| Execution | Spawns an agent as a subprocess in a worktree[^archon-readme] | `pi --mode rpc` in a fresh Docker container[^engine] |
| Capabilities | Per-node skills, MCP, env vars[^archon-ai-assistants] | Sealed connectors, SOPS-decrypted in-memory at launch[^engine] |
| Observation | DB-backed run history, web dashboard[^archon-readme] | Append-only event stream over SSE[^engine] |
| State | SQLite/Postgres[^archon-readme] | Flat JSON + event logs[^engine] |

# Concrete composition

The integration point is Archon's `bash` node calling the `al` CLI — the one place Archon hands control to an external program. An Archon workflow that develops Agent Land itself:

```yaml
# .archon/workflows/fix-issue.yaml
nodes:
  - id: implement
    loop:
      prompt: "Implement the change, run validation, say DONE when green."
      until: ALL_TASKS_COMPLETE
      fresh_context: true
  - id: validate
    bash: "pnpm typecheck && pnpm test"
  - id: approve
    loop: { prompt: "Show the diff, address feedback.", until: APPROVED, interactive: true }
  - id: pr
    prompt: "Push and open a PR (do not merge)."
```

The `implement` node is a bash step one line long when the agent is an Agent Land session instead of an Archon-spawned subprocess:

```yaml
  - id: implement
    bash: "al run --rm 'Implement the change. Run validation. Say DONE when green.' --connector gh-cli"
```

What each side contributes in that one line:

- **Archon** gives the retry loop (`until: ALL_TASKS_COMPLETE`), the approval gate, and the PR step — the control flow Agent Land refuses to own.
- **Agent Land** gives the container-isolated pi session, the SOPS-sealed `gh-cli` connector (token never in the workflow), and `agent_settled` as the loop's `until` signal — surfaced as `al run`'s exit code (0 on settle, 1 on stop).

# When they overlap instead of compose

They are substitutes in one dimension: both spawn pi and both isolate runs (Archon via worktrees, Agent Land via containers). So composition is only worth it when you want what Archon's subprocess/worktree model lacks — untrusted-code isolation, sealed secrets that never touch the workflow file, or long-lived background sessions you can re-attach to. For pure "run a coding agent on my repo and get a PR", Archon alone is enough; Agent Land earns its place when the run needs a sealed capability, a sandbox, or to be watched by something else.

[^archon-readme]: Archon README (dev branch), https://github.com/coleam00/archon
[^archon-ai-assistants]: Archon docs — AI Assistants, https://archon.diy/getting-started/ai-assistants/
[^engine]: `docs/reference/engine.md` — six primitives, three substrates, one engine opinion
