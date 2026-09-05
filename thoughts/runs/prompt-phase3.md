You are an agent-land session dogfooding the platform: implement GitHub issue #56 (Phase 3 — scheduled trigger) end-to-end in marcoklein/agent-land. Work autonomously; never ask questions — make reasonable decisions and document them. Never merge anything.

SETUP
- git clone https://github.com/marcoklein/agent-land.git && cd agent-land && pnpm install
- Git identity: git config user.name "$GIT_USER_NAME"; git config user.email "$GIT_USER_EMAIL".
- GITHUB_TOKEN is in env; gh CLI already authenticates with it (do NOT run gh auth login).
- Push with: git push https://x-access-token:${GITHUB_TOKEN}@github.com/marcoklein/agent-land.git HEAD

CONTEXT
Phase 1 (Platform Connector) and Phase 2 (orchestrator skill) have landed on main. Read agent-image/skills/orchestrator/SKILL.md and agent-image/skills/agent-land-api/SKILL.md and packages/contracts/src/routes.ts on main — the trigger must create sessions against the real API (platform: true, connectors, model).

READ FIRST
- gh issue view 56
- docs/knowledge/multi-agent-workflow.md (Phase 3 section)
- .github/workflows/ci.yml and deploy.yml — follow existing workflow conventions
- docs/knowledge/cli.md, docs/knowledge/learnings/deployment.md

SCOPE
1. Create .github/workflows/pipeline-trigger.yml:
   - Triggers: schedule (hourly) + workflow_dispatch.
   - Job: list open issues in this repo with label `pipeline-ready` that do NOT yet contain a marker comment `<!-- agent-land-pipeline:spawned -->`.
   - For each such issue: POST $AGENT_LAND_URL/api/sessions (secrets: AGENT_LAND_URL, AGENT_LAND_BASIC_AUTH) creating a platform-enabled session whose prompt instructs it to load the orchestrator skill and run the pipeline for that issue number. Then post the marker comment including the session id.
   - Idempotent: the marker comment is the guard; never double-spawn. On API failure: log, exit non-zero, do NOT comment.
   - Keep it a single small job; prefer gh CLI + curl over custom scripts.
2. Create the `pipeline-ready` label in the repo if missing (gh label create --force).
3. Docs: add docs/knowledge/learnings/pipeline-trigger.md (OKF, draft) describing the trigger, required repo secrets (AGENT_LAND_URL, AGENT_LAND_BASIC_AUTH), how to test via workflow_dispatch, and the marker-comment idempotency scheme. Link it from docs/knowledge/multi-agent-workflow.md Phase 3 and docs/knowledge/learnings/index.md.
4. `pnpm typecheck` and `pnpm test` green.

FINISH
- Branch feat/pipeline-trigger off main; conventional commits.
- Push, `gh pr create` (references #56, describes what changed + how verified + notes the secrets the operator must set).
- `gh pr checks <n> --watch` until green; fix and re-push on red.
- `gh issue comment 56` with a summary: PR URL, decisions, operator follow-ups.
