# AGENTS.md

## Branch protection

`main` is protected: direct pushes are blocked (including admins). All changes go through pull requests — feature branch → PR → merge.

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

## Conventions

- Conventional commits (`type(scope): description`, imperative, no period)
- Never commit secrets, `.env`, `.age-key`, or `secrets/*.yaml` (gitignored)
- `thoughts/` stays untracked
- Docs follow the existing `docs/` style: `docs/README.md` index, reference docs in OKF under `docs/reference/`, and ADRs under `docs/adrs/`
