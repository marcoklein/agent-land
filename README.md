# Agent Land

Minimal, self-hosted platform for running Dockerized AI coding agents as long-lived sessions. Choose connectors, send a prompt, and get live-streamed agent output with encrypted secret management via SOPS/Age.

## Quick Start

**Prerequisites:** Docker, Docker Compose, [SOPS](https://github.com/getsops/sops), [Age](https://github.com/FiloSottile/age), and an [OpenCode](https://opencode.ai) API key.

```bash
# 1. Clone and enter the repo
git clone https://github.com/marcoklein/agent-land.git
cd agent-land

# 2. Generate an Age key pair (for encrypting secrets)
age-keygen -o .age-key

# 3. Configure environment
cp .env.example .env

# 4. Build the agent image
docker build -t agent-land-pi:latest ./agent-image

# 5. Start
docker compose up --build -d
```

## Usage

Everything is driven through the JSON/SSE API — the CLI (`al`) is the primary client:

```bash
# configure CLI against the server
export AGENT_LAND_URL=http://localhost:3000

# register a connector (generic env bag, encrypted at rest)
al connectors add --name github --url https://api.github.com --field GITHUB_TOKEN=ghp-xxx

# run a one-shot agent session
al run "Summarize the README of this repo" --model deepseek-v4-pro --rm

# or start an interactive chat
al new --connectors github
```

Agent output streams in real-time via SSE. Each session persists its record to `data/sessions/`.

## Features

- **SOPS/Age secrets** — encrypted at rest, decrypted in-memory only at launch; values never exposed over the API
- **Live log streaming** via SSE — agent events rendered in real-time
- **Connector abstraction** — generic sealed env bags, selected at launch time
- **Provider records** — generic LLM backend configs (base URL, API dialect, models, credentials)
- **RPC-driven sessions** — every session is a running pi agent (`--mode rpc`) with `auto`/`manual` permission policies
- **Session recovery** — durable event log, graceful drain, and re-attach on redeploy
- **Terminal client (`al`)** — zero-dependency CLI to create, chat, watch, and script sessions
- **Pre-baked agent tools** — git, curl, jq, gh ready in the container
- **Agent skills** — bundled skill files teach the agent common APIs (github, jira, gmail)
- **No database** — flat JSON files on mounted volumes
- **Runs on Dokku** — single Dockerfile, no orchestration

## API

The JSON HTTP + SSE API (sessions, connectors, models, providers) is defined once in `packages/contracts/src/routes.ts`. See the [documentation](docs/README.md) for reference and operational learnings.

## Docs

- [Documentation](docs/README.md) — product, reference, learnings, and decisions
- [Architecture Decision Records](docs/adrs/)
- [Contributing](CONTRIBUTING.md)
- [Roadmap](ROADMAP.md)

## License

MIT
