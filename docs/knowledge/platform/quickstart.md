---
type: Guide
title: Quickstart — the operator's first five minutes
description: From a blank machine to your first agent run — start the server, get the CLI, seal a secret, prompt an agent, look at the state.
status: draft
generated: { by: opencode/qwen3.8-max, at: 2026-09-13T00:00:00Z }
sources:
  - id: cli
    resource: /platform/cli.md
    title: CLI (`al`) reference
  - id: env
    resource: .env.example
    title: Server environment template
  - id: deploy
    resource: /learnings/deployment.md
    title: Deployment learnings
---

# Quickstart — the operator's first five minutes

The operator path: deploy agent-land, put an agent to work, watch it, keep the state. Everything here talks to the public JSON/SSE API only; all state lives on the server as plain files, so you can disconnect and re-attach from anywhere at any time. Concepts behind each step: the [engine](/platform/engine.md). Every command and flag: the [CLI reference](/platform/cli.md).

## 1. Start the server

Local, with Docker Compose:

```bash
git clone https://github.com/marcoklein/agent-land.git && cd agent-land
age-keygen -o .age-key            # encryption key for secrets (gitignored)
cp .env.example .env              # edit it: set a real OPENCODE_API_KEY
docker build -t agent-land-pi:latest ./agent-image
docker compose up --build -d      # server on http://localhost:3000
```

Production is one command — `git push dokku main:master`; Dokku builds the Dockerfile, provisions SSL, and places nginx with basic auth in front ([deployment details](/learnings/deployment.md)).

Model credentials work out of the box: the server bootstraps the default provider from `OPENCODE_API_KEY` and `DEFAULT_MODEL` at launch.[^env] Other LLM backends: `al providers add`.

## 2. Get the CLI

```bash
pnpm install
pnpm --filter @agent-land/cli build
pnpm --filter @agent-land/cli link --global    # `al` is now on your PATH
```

Point it at your server:

```bash
export AGENT_LAND_URL=http://localhost:3000    # local
# hosted instance: the URL is the default — set AGENT_LAND_BASIC_AUTH=user:password instead
```

## 3. Seal your first secret

A **connector** is a sealed env bag, injected into sessions at launch — encrypted at rest with SOPS/Age, decrypted in memory only, never exposed over the API:

```bash
al connectors add --name github --field GITHUB_TOKEN=ghp_xxx
al connectors ls        # names and URLs only — secrets never print
```

## 4. First run

```bash
al run "Write a haiku about isolated containers" --rm
```

One command: creates a session (one `pi` agent in one Docker container), prompts it, streams events live to your terminal, prints the final answer, removes the session. For interactive work:

```bash
al new --connectors github      # TTY prompts for provider/model when flags are omitted
al ls                           # find the session id
al chat <session-id>            # attach — history replays, then live events
```

Sessions outlive your terminal: `/quit` detaches while the session keeps running; `al chat` re-attaches from any machine. They also survive server restarts.

## 5. Look at the state

There is no database. Everything you just did is plain JSON on the server's volumes: session records and sequenced event logs under `data/sessions/`, SOPS-encrypted connector files under `secrets/`. Open them in a text editor — that is the point.

## 6. Make a checkout durable

Session filesystems are ephemeral; a **mount** is a durable named volume:

```bash
al mounts add --name myproject
al new --connectors github --mount myproject:/data/myproject
# in the session: git clone … /data/myproject — survives session deletion
```

Before binding a mount to a second session, read the single-writer rule in [mount operations](/learnings/mount-operations.md).

## Next

- See your agents from any browser: open `https://agent-land-ui.host.impromat.app` — the [Web UI](/platform/web-ui.md) shows running sessions, which ones are waiting on you, and your resource inventory
- Drive everything from scripts and cron: the [CLI reference](/platform/cli.md)
- Understand the machine: [engine](/platform/engine.md) · [architecture](/platform/architecture.md)
- Put work on rails — state an outcome, review at gates: the [dogfooding playbook](/playbook/dogfooding.md)

[^env]: `.env.example` — `OPENCODE_API_KEY` and `DEFAULT_MODEL` (defaults to `deepseek-v4-pro`); injected into the default provider's session config at launch.
