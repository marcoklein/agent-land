---
type: Reference
title: CLI (`al`)
description: Install, configure, and drive agent-land from the terminal with the zero-dependency client.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-08-19T00:00:00Z }
sources:
  - id: cli
    resource: packages/cli/src/agent-land.ts
    title: `al` entrypoint + usage text
  - id: config
    resource: packages/cli/src/lib/config.ts
    title: Config loading (env vars)
---

# What it is

`al` is a zero-runtime-dependency Node client (`@agent-land/cli`, TypeScript, Node 20+ stdlib only) that drives the platform API. It is a pure projector/controller — no agent logic, no model calls, no local state. The session lives on the server; the client connects, renders, sends input, and quits. Re-attach from any machine with `al chat <id>`.

# Install

Build the client and link it into pnpm's global `bin`:[^cli]

```bash
pnpm --filter @agent-land/cli build
pnpm --filter @agent-land/cli link --global
```

`al` is then on your `PATH`. A workspace `pnpm install` also exposes it at `node_modules/.bin/al` for repo-local use (`pnpm al -- <args>`). The `bin` entry points at the compiled `dist/agent-land.js`, so re-run `build` after editing the source.

Alternatively, symlink the compiled entrypoint directly:

```bash
pnpm --filter @agent-land/cli build
ln -s "$PWD/packages/cli/dist/agent-land.js" ~/.local/bin/al
```

# Configure

Environment variables only, no config file.[^config]

| Var | Purpose |
|-----|---------|
| `AGENT_LAND_URL` | API base URL; defaults to `https://agent-land.host.impromat.app` |
| `AGENT_LAND_AUTH_USER` | Basic auth user |
| `AGENT_LAND_AUTH_PASSWORD` | Basic auth password |
| `AGENT_LAND_BASIC_AUTH` | Alternative single var `user:password` (takes precedence over the pair) |

Local dev: `AGENT_LAND_URL=http://localhost:3000` and no auth vars (the dev server has none).

# Command surface

```
al new [--workspace <repoUrl>] [--ref <branch>] [--connectors a,b,c] [--model <m>] [--manual]
al chat <session-id>            attach (history replays, then live events)
al ls [--json]                  list sessions with status, age, model, workspace, connectors
al rm <session-id> [-y|--yes]   delete a session (prompts y/N while running)
al log <session-id> [--follow] [--json]
al models                       list available models
al connectors ls                list connectors (name, type, url — never secrets)
al connectors add --name <n> --type <type> --url <u> [--field K=V ...] [--content <yaml>]
al connectors rm <name> [-y|--yes]
al run <message> [new-flags] [--rm] [--timeout <s>] [--verbose]
                                one-shot: create → prompt → wait for settle → print final answer
al watch [<session-id> | --all] tail live events, print "<id>: settled" (stdout only)
```

`al run` exits 0 on `agent_settled` and 1 on stop/timeout; the session is kept unless `--rm`. `--manual` sets `permissionPolicy: "manual"` so dialogs reach the client.

# In chat

- `/quit`, `/exit` — detach (session keeps running; re-attach with `al chat <id>`)
- `ctrl-c` once — abort the current turn; again — detach
- `/help` — show the hint

[^cli]: `packages/cli/src/agent-land.ts`, `USAGE`
[^config]: `packages/cli/src/lib/config.ts`
