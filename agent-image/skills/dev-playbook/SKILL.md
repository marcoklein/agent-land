---
name: dev-playbook
description: The agent-land development loop — how an agent must drive a change from branch to a green, review-ready PR. Active whenever the agent is asked to implement a change to the agent-land repo.
---

# dev-playbook — the development loop

## Authentication (set once per session, before the first commit)

- `gh` needs no login — it reads `GITHUB_TOKEN` from the environment. **Do not run `gh auth login`**; it fails when `GITHUB_TOKEN` is already set. Verify with `gh auth status`.
- Push via the token, not ssh:

  ```bash
  git push https://x-access-token:${GITHUB_TOKEN}@github.com/marcoklein/agent-land.git HEAD
  ```

- Set git identity before the first commit:

  ```bash
  git config user.name "$GIT_USER_NAME"
  git config user.email "$GIT_USER_EMAIL"
  ```

## Loop

1. **Clone** the repo fresh (or reuse the session working directory if already cloned).
2. **Branch** off `main`: `fix/…`, `feat/…`, `docs/…`, `refactor/…`, `chore/…`.
3. **Change** — make the edit.
4. **Verify** — `pnpm typecheck` and `pnpm test`; fix failures until both pass.
5. **Commit** — conventional message (`type(scope): description`, imperative, no period). Never commit secrets, `.env`, `.age-key`, or `secrets/*.yaml`.
6. **Push** — via `x-access-token`.
7. **Open PR** — `gh pr create` with a title and a short body: what changed and how it was verified.
8. **Watch CI** — `gh pr checks <number> --watch`; if red, fix, commit/push again, and re-watch until green.
9. **Report** — the PR URL and CI status. Do **not** merge; merging stays human-gated.

## Rules

- Never merge.
- Never commit secrets or anything gitignored.
- Deterministic steps (`pnpm typecheck`, `pnpm test`, `gh pr checks`) run as commands; only the change itself is open-ended.
