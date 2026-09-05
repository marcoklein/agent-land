---
type: Reference
title: First dogfooding run (Phase 0)
description: The first `al run` that produced a real agent-land PR end-to-end against the live platform, and the gaps it surfaced.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: dogfooding
    resource: /dogfooding.md
    title: Dogfooding — developing agent-land on agent-land
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: SessionService.resolveAgentEnv — capability env injection
  - id: first-pr
    resource: https://github.com/marcoklein/agent-land/pull/43
    title: PR #43 — docs: mark node/pnpm pre-baking enabler as done
---

# First dogfooding run (Phase 0)

On 2026-09-05 the first Phase 0 run[^dogfooding] completed end-to-end: `al run` against the live platform (`agent-land.host.impromat.app`, connector `GitHub Personal All Repos`, model `deepseek-v4-pro`) produced [PR #43][^first-pr] with no human intervention between the prompt and the opened PR.

# What worked

The agent ran the whole loop autonomously: clone → set git identity → branch `docs/fix-dogfooding-gap` → edit the stale row in `dogfooding.md` → conventional commit → push → `gh pr create`. It recovered from a failed `gh auth login` (exit 1) by pushing directly via `https://x-access-token:${GITHUB_TOKEN}@…`, then confirmed `gh auth status` before `gh pr create`.

# Gaps surfaced

1. **`gh auth login` errors when `GITHUB_TOKEN` is already set.** The CLI refuses to log in with a token while the env var is present (exit 1). `gh` still authenticates fine from the env var alone, but the failure forces the agent to fall back to `x-access-token` git URLs. A checked-in dev playbook (Phase 2) should codify "push with `x-access-token`, use `gh` as-is, skip `gh auth login`".

2. **Git identity is not injected.** `resolveAgentEnv`[^session-service] injects connector and provider secrets, but not `user.name`/`user.email`, so the agent only commits after being explicitly told to `git config`. Candidate: inject `GIT_USER_NAME`/`GIT_USER_EMAIL` from server config at session creation, or make the dev playbook set it as a first step.

3. **No secret scanning inside the agent container.** The repo's `pre-commit` gitleaks hook lives in the source tree (`.git/hooks/`), which a fresh clone does not carry, and `gitleaks` is not installed in the agent image. The agent pushes via `https://x-access-token:${GITHUB_TOKEN}@…` with no local hook to stop it. This is acceptable today because GitHub **push protection** (enabled on the repo) still rejects the push server-side before anything lands; the agent just gets the rejection mid-flight rather than up front. Making prevention in-agent (pre-bake gitleaks + a global `core.hooksPath`) is a real image change to schedule, not a gap in the platform's security posture.

[^dogfooding]: [Dogfooding strategy](/dogfooding.md)
[^session-service]: `packages/server/src/core/session-service.ts`, `resolveAgentEnv()`
[^first-pr]: PR #43
