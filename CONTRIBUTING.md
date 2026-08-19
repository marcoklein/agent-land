# Contributing

## Setup

**Prerequisites:** Node.js 22+, pnpm, Docker, SOPS, Age, and an [OpenCode](https://opencode.ai) API key.

```bash
pnpm install
cp .env.example .env
# Set OPENCODE_API_KEY in .env
docker build -t agent-land-pi:latest ./agent-image
pnpm dev
# → http://localhost:3000
```

## Before Submitting

- Run `pnpm typecheck` — all TypeScript must compile without errors
- Run `pnpm test` — all tests must pass
- Follow [conventional commits](https://www.conventionalcommits.org/): `type(scope): description`
- Never commit `.env`, `.age-key`, or `secrets/*.yaml` (gitignored)

## Layout

This is a pnpm monorepo:

- `packages/server/` — Express 5 orchestrator (TypeScript)
  - routes in `src/routes/`, services in `src/core/`, infrastructure in `src/infra/`
  - EJS templates in `src/views/`, static assets in `public/`
- `packages/cli/` — the `al` terminal client (TypeScript, zero runtime deps)
- `agent-image/` — the agent container build context (pi, git, gh, SOPS, Age)

## Code Style

- TypeScript with strict mode
- Keep it minimal — no ORM, no database, no build step for frontend

## Architecture Decisions

Significant architectural decisions are documented as [ADRs](docs/adrs/) using a lightweight template. Write one when introducing a new library, pattern, or constraint.
