---
name: dev-playbook
description: The agent-land development loop — how an agent must drive a change from branch to a green, review-ready PR. Active whenever an agent is asked to implement a change in this repo.
---

# dev-playbook — the development loop an agent follows

The contract every agent-land session must follow when making a change here. It closes the gaps found in the first dogfooding run: `gh` already auths from the injected `GITHUB_TOKEN`, `git push` must use `x-access-token`, and git identity must be set before the first commit. Do not skip a step; do not stop between steps.

## Authentication (set once per session, before the first commit)

- `gh` needs no login — it reads `GITHUB_TOKEN` from the environment. **Do not run `gh auth login`**; it fails when `GITHUB_TOKEN` is already set. Verify with `gh auth status`.
- `git push` authenticates via the token, not ssh. Push with:

  ```bash
  git push https://x-access-token:${GITHUB_TOKEN}@github.com/marcoklein/agent-land.git HEAD
  ```

  Or set the remote once: `git remote set-url origin https://x-access-token:${GITHUB_TOKEN}@github.com/marcoklein/agent-land.git`.

- Set git identity before the first commit:

  ```bash
  git config user.name "$GIT_USER_NAME"
  git config user.email "$GIT_USER_EMAIL"
  ```

## Loop

1. **Get the checkout** — clone the repo fresh, or reuse a mounted checkout. On a mount (e.g. `/data/agent-land`), sync first: `git fetch origin && git checkout main && git reset --hard origin/main` — the mount is a cache of main, not a source of truth.
2. **Branch** off `main`: `fix/…`, `feat/…`, `docs/…`, `refactor/…`, `chore/…`.
3. **Change** — make the edit.
4. **Verify** — `pnpm typecheck` and `pnpm test`; fix failures until both pass.
5. **Commit** — conventional message (`type(scope): description`, imperative, no period). Never commit secrets, `.env`, `.age-key`, or `secrets/*.yaml`.
6. **Push** — via `x-access-token` (see above).
7. **Open PR** — `gh pr create` with a title and a short body: what changed and how it was verified.
8. **Watch CI** — `gh pr checks <number> --watch`; if red, fix, commit/push again, and re-watch until green.
9. **Report** — the PR URL and CI status. Do **not** merge; merging stays human-gated.

## Rules

- Never merge — merge is the human gate.
- Never commit secrets or anything gitignored (`.env`, `.age-key`, `secrets/*.yaml`). Secret scanning (pre-commit gitleaks + GitHub push protection) is the backstop, not an excuse.
- Deterministic steps (`pnpm typecheck`, `pnpm test`, `gh pr checks`) run as commands between decisions; only the change itself is open-ended.
