# Agent Land

Minimal, self-hosted platform for running Dockerized AI coding agents. Choose connectors, write a task, and get live-streamed agent output with encrypted secret management via SOPS/Age.

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
3. **Agents** — write a task, select connectors, launch

Agent output streams in real-time via SSE. Each run writes logs to `data/logs/`.

## Features

- **SOPS/Age secrets** — encrypted at rest, decrypted in-memory only at launch
- **Live log streaming** via SSE — styled agent output in real-time
- **Connector abstraction** — point at encrypted secrets, select at launch time
- **Pre-baked agent tools** — git, curl, jq, gh ready in the container
- **Agent skills** — each connector type teaches the agent how to use the API
- **No database** — flat JSON files on mounted volumes
- **Runs on Dokku** — single Dockerfile, no orchestration

## Architecture

```mermaid
flowchart LR
    Browser --> Orchestrator --> Docker[Agent Container]
    Docker --> More[...]
    Orchestrator --> Secrets[(SOPS Secrets)]
    Docker --> GitHub
    Docker --> Jira
    Docker --> Gmail
```

The **orchestrator** is a Node.js/TypeScript Express server with HTMX + Pico CSS frontend. Agent **containers** run [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) headless with pre-baked tools (git, curl, jq, gh). Secrets are encrypted at rest with SOPS/Age and decrypted in-memory only when launching an agent.

## Docs

- [Architecture Decision Records](docs/adrs/)
- [Contributing](CONTRIBUTING.md)
- [Roadmap](ROADMAP.md)

## License

MIT
