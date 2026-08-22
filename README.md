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
# Open http://localhost:3000
```

## Usage

1. **Secrets** — add encrypted API tokens (e.g. Jira PAT, GitHub token)
2. **Connectors** — create named pointers to those secrets
3. **Sessions** — write a prompt, select connectors, launch

Agent output streams in real-time via SSE. Each session persists its record to `data/sessions/`.

## Features

- **SOPS/Age secrets** — encrypted at rest, decrypted in-memory only at launch
- **Live log streaming** via SSE — styled agent output in real-time
- **Connector abstraction** — point at encrypted secrets, select at launch time
- **RPC-driven sessions** — every session is a running pi agent (`--mode rpc`) with `auto`/`manual` permission policies
- **Session recovery** — durable event log, graceful drain, and re-attach on redeploy
- **Terminal client (`al`)** — zero-dependency CLI to create, chat, watch, and script sessions
- **Pre-baked agent tools** — git, curl, jq, gh ready in the container
- **Agent skills** — each connector type teaches the agent how to use the API
- **No database** — flat JSON files on mounted volumes
- **Runs on Dokku** — single Dockerfile, no orchestration

## API

The JSON HTTP + SSE API (sessions, connectors, models, providers, Copilot) is defined once in `packages/contracts/src/routes.ts`. See the [documentation](docs/README.md) for reference and operational learnings.

## Docs

- [Documentation](docs/README.md) — product, reference, learnings, and decisions
- [Architecture Decision Records](docs/adrs/)
- [Contributing](CONTRIBUTING.md)
- [Roadmap](ROADMAP.md)

## License

MIT
