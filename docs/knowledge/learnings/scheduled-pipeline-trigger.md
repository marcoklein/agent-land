---
type: Reference
title: Scheduled pipeline trigger — cron starts the pipeline with nobody at a terminal
description: The Phase 3 GitHub Actions cron that spawns an orchestrator session for each unstarted pipeline-ready issue, and the operator-auth, no-Mount, and marker-comment idempotency decisions behind it.
status: draft
tags: [orchestration, cron, github-actions, platform-connector, dogfooding, pipeline]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T16:11:47Z }
sources:
  - id: roadmap
    resource: /multi-agent-workflow.md
    title: Multi-agent workflow roadmap — Phase 3
  - id: orchestrator
    resource: ../../../agent-image/skills/orchestrator/SKILL.md
    title: Orchestrator recipe — the session this trigger spawns
  - id: loopback
    resource: /learnings/first-loopback-run.md
    title: First loopback run — app-level auth and URL gotchas
  - id: platform-connector
    resource: /product/designs/platform-connector-design.md
    title: Platform Connector design note
---

# Scheduled pipeline trigger — cron starts the pipeline with nobody at a terminal

Phase 3 of [the roadmap](/multi-agent-workflow.md) landed as [`../../../.github/workflows/pipeline-trigger.yml`](../../../.github/workflows/pipeline-trigger.yml): an hourly (`0 * * * *`) + `workflow_dispatch` GitHub Actions job that scans for open issues labeled `pipeline-ready` and spawns an orchestrator session for each one that has not been started. Label an issue → spec and design PRs appear with nobody at a terminal.

## How it works

1. `gh issue list --label pipeline-ready --state open` finds the candidates.
2. The **start marker** de-dups. The orchestrator posts `🤖 Orchestrator started: …` as its first issue comment (see [the orchestrator recipe](../../../agent-image/skills/orchestrator/SKILL.md)); the workflow spawns only for issues whose comments do **not** contain that marker.
3. `POST /api/sessions` creates the session with `{"connectors":["<GitHub connector>"],"platform":true}` — **no Mount** — then `POST /api/sessions/:id/prompt` queues the run with a prompt that points at the orchestrator skill path so the session knows its recipe. The connector name is discovered at run time (`GET /api/connectors`, first connector whose `envKeys` include `GITHUB_TOKEN`) because connectors resolve by **exact name** — a hardcoded `"github"` would silently match nothing.

## Decisions

- **Operator auth, not session auth.** The workflow is not an agent-land session, so it has no ephemeral `session-<id>:<token>`. It authenticates as the operator via the `AGENT_LAND_URL` / `AGENT_LAND_BASIC_AUTH` GitHub Actions secrets — the same operator credential the app-level auth middleware already accepts[^loopback].
- **No Mount on the spawned session.** The orchestrator recipe binds no checkout itself: the single-writer Mount invariant means exactly one stage child holds the repo Mount at a time. The workflow must not add a Mount to the orchestrator, or every child create would fail.
- **Marker comment is the idempotency guard.** The start/not-started signal is an issue comment, not a session lookup, because the workflow has no durable issue → session-id mapping.
- **`platform: true`** injects the loopback env vars the orchestrator needs to drive its children.

## Known limits

- **Race: spawn → marker.** The marker is posted by the orchestrator on its first turn, which can be slow (the first session create triggers an agent-image rebuild — see [agent-image staleness](/learnings/agent-image-staleness.md)). A poll inside that window can spawn a second orchestrator for the same issue. Accepted for the first cut; a follow-up should check for a live session per issue instead of relying only on the comment.
- **Start only, not resume.** This trigger removes the *start* nudge. The *resume* half of Phase 3 (advancing an orchestrator parked at a cleared gate when review feedback lands) is still open — it needs a durable issue → session mapping and a re-prompt path, neither of which exists yet.
- **Secrets must exist.** `AGENT_LAND_URL` / `AGENT_LAND_BASIC_AUTH` are operator-added GitHub secrets; the workflow fails fast (`:?` guard) if they are missing.

[^loopback]: [First loopback run](/learnings/first-loopback-run.md) — the app-level auth middleware accepts both the operator credential and per-session credentials.
