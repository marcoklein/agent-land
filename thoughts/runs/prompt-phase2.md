You are an agent-land session dogfooding the platform: implement GitHub issue #55 (Phase 2 — static orchestrator recipe) end-to-end in marcoklein/agent-land. Work autonomously; never ask questions — make reasonable decisions and document them. Never merge anything.

SETUP
- git clone https://github.com/marcoklein/agent-land.git && cd agent-land && pnpm install
- Git identity: git config user.name "$GIT_USER_NAME"; git config user.email "$GIT_USER_EMAIL".
- GITHUB_TOKEN is in env; gh CLI already authenticates with it (do NOT run gh auth login).
- Push with: git push https://x-access-token:${GITHUB_TOKEN}@github.com/marcoklein/agent-land.git HEAD

CONTEXT
Phase 1 (Platform Connector, issue #54) has already landed on main: sessions can be created with `platform: true` and `parentSessionId`, the engine injects AGENT_LAND_URL and AGENT_LAND_BASIC_AUTH (per-session ephemeral identity), and there is a bundled skill agent-image/skills/agent-land-api/SKILL.md for driving the API from inside a session. Read that skill and the actual contracts code on main — your recipe must match the real API exactly (packages/contracts/src/routes.ts, session.ts, event.ts), not an assumed one.

READ FIRST
- gh issue view 55
- docs/knowledge/multi-agent-workflow.md (Phase 2 section)
- docs/knowledge/product/pipeline.md, docs/knowledge/learnings/archon-inspiration.md
- agent-image/skills/agent-land-api/SKILL.md, agent-image/skills/product/SKILL.md, agent-image/skills/dev-playbook/SKILL.md
- .opencode/skills/okf/SKILL.md — follow OKF conventions for any doc you touch.
- docs/knowledge/product/designs/platform-connector-design.md (if present)

SCOPE
1. Create agent-image/skills/orchestrator/SKILL.md: the deterministic stage-list recipe for a platform-enabled orchestrator session. Fixed stages: research → refine (feature note + spec PR) → design (design note + design PR) → critic review. Rules:
   - Each stage is a fresh child session created with parentSessionId set to the orchestrator, connectors limited to what the stage needs, platform=false for children.
   - Sequential execution only (Mount single-writer invariant); the orchestrator decides stage content, never control flow.
   - Exact curl recipes for create → prompt → SSE-watch until agent_settled → collect result, matching the real API.
   - Intake: `gh issue view <n>` for an issue labeled `pipeline-ready`; post one progress comment per stage transition.
   - Human gates: after the spec PR and after the design PR, the orchestrator parks (settles with a summary + question); a human re-prompt carries the gate outcome (approved / feedback) and the loop resumes.
2. Fallback section in the same skill: how to run the identical recipe today from a human-driven session without platform injection (human spawns each child with `al run` and pastes results back).
3. Update docs/knowledge/multi-agent-workflow.md Phase 2 to point at the skill; keep OKF frontmatter valid.
4. `pnpm typecheck` and `pnpm test` green (docs/skill-only change, but run them anyway).

FINISH
- Branch feat/orchestrator-skill off main; conventional commits.
- Push, `gh pr create` (references #55, describes what changed + how verified).
- `gh pr checks <n> --watch` until green; fix and re-push on red.
- `gh issue comment 55` with a summary: PR URL, key decisions, gaps found.
