---
type: Reference
title: CLI (`al`)
description: Install, configure, and drive agent-land from the terminal with the zero-dependency client.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-08-19T00:00:00Z }
verified: { by: human:marcoklein, at: 2026-09-01T00:00:00Z }
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

Environment variables; as a convenience the CLI also loads `.env` **from the current working directory** (dotenv) — run `al` from the repo root for that to apply.[^config]

| Var | Purpose |
|-----|---------|
| `AGENT_LAND_URL` | API base URL; defaults to `https://agent-land.host.impromat.app` |
| `AGENT_LAND_AUTH_USER` | Basic auth user |
| `AGENT_LAND_AUTH_PASSWORD` | Basic auth password |
| `AGENT_LAND_BASIC_AUTH` | Alternative single var `user:password` (takes precedence over the pair) |

Local dev: `AGENT_LAND_URL=http://localhost:3000` and no auth vars (the dev server has none).

# Command surface

```
al new [--connectors a,b,c] [--mount NAME:PATH]... [--model <m>] [--provider <id>] [--manual]
al chat <session-id>            attach (history replays, then live events)
al ls [--json]                  list sessions with status, age, model, connectors
al rm <session-id> [-y|--yes]   delete a session (prompts y/N while running)
al log <session-id> [--follow] [--json]
al models [--provider <id>]     list available models
al providers [--json]           list configured providers (id, label, api, enabled)
al providers add --id <slug> [--label <l>] [--base-url <u>] [--api <type>]
                 [--default-model <m>] [--models a,b,c] [--field K=V ...]
                 [--content <yaml>] [--api-key <key>]
al providers rm <id> [-y|--yes]
al connectors ls                list connectors (name, url — never secrets)
al connectors add --name <n> [--url <u>] [--field K=V ...] [--content <yaml>]
al connectors rm <name> [-y|--yes]
al mounts ls                    list mounts
al mounts add --name <n>        create a named mount (durable Docker volume)
al mounts rm <name> [-y|--yes]  delete a mount (fails while a live session binds it)
al run <message> [new-flags] [--rm] [--timeout <s>] [--verbose]
                                one-shot: create → prompt → wait for settle → print final answer
al watch [<session-id> | --all] tail live events, print "<id>: settled" (stdout only)
```

`al new` and `al run` are interactive in a TTY: when provider/model/connectors flags are omitted, they prompt for them. Repo setup (e.g. `git clone`) is left to the agent — start a session and ask it to clone the repo, or bind a [Mount](/product/features/mount.md) with `--mount NAME:PATH` (repeatable) so the checkout persists across sessions; see [mount operations](/learnings/mount-operations.md) for the sync rule. `al run` exits 0 on `agent_settled` and 1 on stop/timeout; the session is kept unless `--rm`. A `run failed: terminated` exit is a transport failure (often the [self-deploy hazard](/learnings/self-deploy-hazard.md)) — the session usually survives; check `al ls`. `--manual` sets `permissionPolicy: "manual"` so dialogs reach the client.

# In chat

- `/quit`, `/exit` — detach (session keeps running; re-attach with `al chat <id>`)
- `ctrl-c` once — abort the current turn; again — detach
- `/help` — show the hint

[^cli]: `packages/cli/src/agent-land.ts`, `USAGE`
[^config]: `packages/cli/src/lib/config.ts`
