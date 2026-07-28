# Contributing

## Setup

**Prerequisites:** Node.js 22+, Docker, SOPS, Age, and an [OpenCode](https://opencode.ai) API key.

```bash
npm install
cp .env.example .env
# Set OPENCODE_API_KEY in .env
docker build -t agent-land-pi:latest ./agent-image
npm run dev
# → http://localhost:3000
```

## Before Submitting

- Run `npm run typecheck` — all TypeScript must compile without errors
- Follow [conventional commits](https://www.conventionalcommits.org/): `type(scope): description`
- Never commit `.env`, `.age-key`, or `secrets/*.yaml` (gitignored)

## Code Style

- TypeScript with strict mode
- Express 5 route handlers in `src/routes/`
- Services in `src/services/`
- EJS templates in `src/views/`
- Keep it minimal — no ORM, no database, no build step for frontend

## Architecture Decisions

Significant architectural decisions are documented as [ADRs](docs/adrs/) using a lightweight template. Write one when introducing a new library, pattern, or constraint.
