---
type: Design
title: Git identity injection
description: The server injects GIT_USER_NAME/GIT_USER_EMAIL from its own config into every session env, so agents commit without being told who they are.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
verified: { by: human:marcoklein, at: 2026-09-05T00:00:00Z }
sources:
  - id: gap
    resource: /learnings/first-dogfooding-run.md
    title: First dogfooding run — gap #2, git identity not injected
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: SessionService.resolveAgentEnv — capability env injection
  - id: config
    resource: packages/server/src/config.ts
    title: Server config (env-driven)
---

# Git identity injection

Gap #2 from the first dogfooding run[^gap]: agents can only commit after being explicitly told to `git config user.name/user.email`. The platform already knows the operator's git identity (`GIT_USER_NAME`/`GIT_USER_EMAIL` are server config on every deployment) — inject it.

## Approach

No new primitive: two more capability env vars resolved at session creation, alongside connector and provider secrets. `resolveAgentEnv` injects them when the server config has them, and never overrides connector-provided values (connector wins — it is the more specific capability).

## Interfaces

- `Config` gains `gitUserName: string` and `gitUserEmail: string`, read from `GIT_USER_NAME` / `GIT_USER_EMAIL` (empty string when unset).
- `resolveAgentEnv`: after connector/provider injection, set `GIT_USER_NAME`/`GIT_USER_EMAIL` from config **only if** not already present in the map.
- `.env.example`: document both vars.
- dev-playbook skill (both copies — `.opencode/skills/` and `agent-image/skills/`): the git-identity step becomes "the platform injects `GIT_USER_NAME`/`GIT_USER_EMAIL`; `git config user.name "$GIT_USER_NAME"` works out of the box. If unset, ask the operator in the prompt."

## Risks & mitigations

- **Identity unset on the host** → injection is skipped (empty config value ⇒ var not set); the playbook fallback keeps the agent working. No empty-var footgun.
- **Connector name collision** → connector-provided values win; deliberate, documented.

## ADR pointers

None — env injection is existing engine behavior (ADR-004 connector model), this only widens what the server synthesizes. Note: engine.md invariant "the platform never synthesizes variables" applies to *connector* env bags; session-launch env (`PI_OFFLINE`, `PI_CODING_AGENT_*`) is already synthesized, and this joins that class.

## Minimal change set

- `packages/server/src/config.ts` — two fields.
- `packages/server/src/core/session-service.ts` — injection in `resolveAgentEnv`.
- `.env.example` — document.
- `.opencode/skills/dev-playbook/SKILL.md` + `agent-image/skills/dev-playbook/SKILL.md` — identity step.
- `packages/server/src/__tests__/` — test: injected when configured, skipped when unset, connector wins.

[^gap]: [First dogfooding run](/learnings/first-dogfooding-run.md) — gap #2
