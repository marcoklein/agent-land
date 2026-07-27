---
name: commit
description: Write conventional commit messages. Active when committing changes to git.
---

## When to Commit

Commit after each meaningful unit of work. One commit per logical change. Never mix unrelated changes.

## Format

```
type(scope): description
```

No period at the end. Imperative mood ("add" not "added"). Keep under 72 characters.

## Types

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation or ADRs |
| `refactor` | Code change without feature or fix |
| `chore` | Build, deps, config, tooling |
| `test` | Adding or updating tests |
| `style` | Formatting, whitespace (no logic change) |

## Scope

Short noun describing the area: `docker`, `secrets`, `ui`, `agent`, `adr`, `sse`. Omit if the change is broad.

## Examples

```
feat(agent): add real-time docker log streaming
fix(sse): handle multiline output in data lines
docs(adr): record connector model decision
chore: add ca-certificates to agent image
```

## Rules

- Never include secrets, tokens, or API keys in commit messages
- Never commit `.env`, `.age-key`, or `secrets/*.yaml` (gitignored)
- Review `git diff --staged` before committing
- Run `npm run typecheck` before committing if code changed
- Use `git add <specific files>` — never `git add -A` blindly
