# AGENTS.md

## Branch protection

`main` is protected: direct pushes are blocked (including admins). All changes go through pull requests — feature branch → PR → merge.

## Commands

```bash
pnpm typecheck      # tsc --noEmit (all packages)
pnpm test           # vitest run (all packages)
pnpm dev            # run the server locally (tsx watch)
pnpm build          # tsc (all packages)
```

## Conventions

- Conventional commits (`type(scope): description`, imperative, no period)
- Never commit secrets, `.env`, `.age-key`, or `secrets/*.yaml` (gitignored)
- `thoughts/` stays untracked
- Docs follow the existing `docs/` style: everything lives in the OKF knowledge bundle under `docs/knowledge/` (reference, product, learnings, and ADRs under `docs/knowledge/adrs/`)

## Development loop

When asked to implement a change, drive it to a green PR and report the result — do not stop after a single step or wait to be nudged between steps.

The full contract (auth via injected `GITHUB_TOKEN`, push via `x-access-token`, git identity, CI-watch discipline) lives in `.opencode/skills/dev-playbook/SKILL.md` — follow it.

1. Set git identity, then create a branch off `main` (`fix/…`, `feat/…`, `docs/…`, `refactor/…`, `chore/…`).
2. Make the change, then `pnpm typecheck` and `pnpm test` — fix failures until both pass.
3. Commit (conventional message) and push via `https://x-access-token:${GITHUB_TOKEN}@github.com/…`.
4. Open a PR with `gh pr create` (title + a short body describing what changed and how it was verified).
5. `gh pr checks <number> --watch`; if CI is red, fix, commit/push again, and re-watch until green.
6. Report the PR URL and CI status. Do not merge — merging stays human-gated.
