---
type: Reference
title: Git workspace provisioning
description: How a session gets a persistent checkout, and the git/gh details that matter.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-08-19T00:00:00Z }
sources:
  - id: provisioner
    resource: src/infra/git-clone-provisioner.ts
    title: GitCloneProvisioner implementation
  - id: session-service
    resource: src/core/session-service.ts
    title: SessionService (volume creation + kill)
  - id: provision-test
    resource: src/__tests__/workspace-provisioning.test.ts
    title: Workspace provisioning tests
---

# Model

Provisioning is one step between container creation and agent start, expressed as a port (`WorkspaceProvisioner.provision`) so the core domain never learns git, `gh`, or credential details.[^provision-test] The only adapter today is `GitCloneProvisioner`.

# Bootstrap steps (in order)

`GitCloneProvisioner.provision` runs, in order:[^provisioner]

1. **Git identity** — `git config --global user.name` / `user.email` from orchestrator env (`GIT_USER_NAME`, `GIT_USER_EMAIL`). Commits are attributed correctly without relying on the agent.
2. **Push auth** — `gh auth setup-git`, only when a GitHub connector's `GITHUB_TOKEN` is present in the container env. This wires git's credential helper so `gh` supplies the token on demand — **the token never lands in `.git/config` or any workspace file**.
3. **Checkout** — `git clone -- <repoUrl> /workspace`, then `git -C /workspace checkout -- <ref>` when a ref is given.

Any failing step aborts the launch: container and workspace volume are removed, the error is scrubbed of credentials and surfaced on the API/UI.

# Volume & lifecycle

- Per-session named volume `agent-land-ws-<id>` mounted at `/workspace`.[^session-service]
- `kill()` stops the agent and removes the container but **keeps** the workspace volume — the checkout is not lost.
- The shared `agent-land-sessions` volume is session data only; the workspace is separate.

[^provisioner]: `src/infra/git-clone-provisioner.ts`
[^session-service]: `src/core/session-service.ts`
[^provision-test]: `src/__tests__/workspace-provisioning.test.ts`
