---
type: Reference
title: First loopback run — Platform Connector in the live host
description: What the first live multi-session run on the hosted platform broke and taught: nginx basic-auth blocks loopback, the localhost URL footgun is real, image rebuilds hide behind tag bumps, and SSE streams never close on settle.
status: draft
tags: [loopback, platform-connector, deployment, nginx, sse, dogfooding]
generated: { by: opencode/qwen3.8-max, at: 2026-09-05T15:30:00Z }
sources:
  - id: design
    resource: /product/designs/platform-connector-design.md
    title: Platform Connector design note
  - id: staleness
    resource: /learnings/agent-image-staleness.md
    title: Agent image staleness on deploy
  - id: selfdeploy
    resource: /learnings/self-deploy-hazard.md
    title: Self-deploy hazard
  - id: roadmap
    resource: /multi-agent-workflow.md
    title: Multi-agent workflow roadmap
---

# First loopback run — Platform Connector in the live host

On 2026-09-05 the first platform-enabled session on the hosted platform (`agent-land.host.impromat.app`) created a child session, prompted it, and read back `CHILD-OK` — the composition loop of [the roadmap](/multi-agent-workflow.md) Phase 1 is live. Getting there broke four things worth remembering.

## 1. nginx basic-auth sits *in front of* the app and rejects session credentials

The host terminated auth at nginx (`auth_basic` + htpasswd in `/home/dokku/agent-land/nginx.conf.d/http-auth.conf`). A loopback child authenticates as `session-<id>:<token>` — credentials nginx's htpasswd has never heard of, so every loopback call died with a 401 *at the proxy*, never reaching the app middleware that would have accepted them.

**Fix applied:** delete `http-auth.conf`, move auth into the app by setting the operator credential (`AGENT_LAND_BASIC_AUTH`) via `dokku config:set`, and rebuild the nginx config. The app middleware[^design] now validates both identities; nginx just proxies. **Rule: loopback requires app-level auth — any proxy in front must not enforce its own.**

## 2. The app middleware must pass through forwarded headers when no operator credential is configured

The first cut of the middleware 401'd any request carrying an `Authorization` header when `operatorBasicAuth` was unset — which is exactly what a reverse proxy forwards. The hosted deploy went down with 401s until the pass-through fix (PR #59). Regression test now pins the behavior.

## 3. The `localhost` URL footgun is real, not theoretical

The design note warned that `AGENT_LAND_URL` defaults to `http://localhost:${PORT}`, which inside a sibling container points at the container itself. The smoke test confirmed it: `curl: (7) Failed to connect to localhost port 3000`. **Fix applied:** `dokku config:set agent-land AGENT_LAND_URL=https://agent-land.host.impromat.app` — the public URL is reachable from session containers, and session credentials now pass because of fix #1.

## 4. Skill/image updates need a tag bump — and the rebuild hides inside the first session create

`ensureAgentImage` builds only when the tag is absent[^staleness], so the freshly bundled `agent-land-api` skill was invisible to sessions. Workaround used: `dokku config:set agent-land AGENT_IMAGE=agent-land-pi:0.2` — a new tag forces a rebuild from the deployed `/agent-image`. Two operational wrinkles:

- The rebuild runs lazily during the **first session create**, which can outlast client timeouts — `al run` reported `The operation was aborted due to timeout` while the server happily finished creating the session. Check `al ls` before retrying, and re-prompt the orphaned session instead of creating a duplicate.
- `dokku config:set` redeploys the app — mind the [self-deploy hazard](/learnings/self-deploy-hazard.md) when sessions are running.

## 5. SSE `?live=1` never closes — watch loops must break on `agent_settled`

A watcher streaming `GET /api/sessions/:id/events?live=1` with plain `curl -N` hangs forever after the child settles; the stream stays open by design. The smoke-test orchestrator stalled on exactly this. Watch loops must break on the `agent_settled` event (the `jq --unbuffered` + read-loop pattern in the `agent-land-api` skill), or poll session status instead.

## What worked

- Per-session ephemeral credentials: minted, injected, accepted by the app, invisible in API responses.
- Lineage: `parentSessionId` round-trips; `al ls --tree` renders the parent/child relationship live.
- Child lifecycle from inside a session: create (201) → prompt (202) → settled child replying exactly `CHILD-OK` → delete.
