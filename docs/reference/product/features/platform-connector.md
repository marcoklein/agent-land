---
type: Feature
title: Platform Connector
description: The engine self-injects AGENT_LAND_URL and AGENT_LAND_BASIC_AUTH into a session so the agent can create, prompt, and observe child sessions.
status: draft
tags: [engine, composition, multi-agent, loopback]
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: engine
    resource: /reference/engine.md
    title: Agent Land engine — the purest form
---

# Platform Connector

The loopback primitive. At session creation, the engine injects its own address and credentials into the container, turning every agent into a first-class client of the platform.

## Why

Multi-agent composition currently has no home: the only way to split work is for a human to run two sessions and shuttle context between them. Platform Connector gives a session the two env vars it needs to call the JSON/SSE API and spawn children — so an orchestrator agent can run on the platform and drive sub-agents itself.

## User stories

- As an orchestrator agent, I want to create a child session with a subset of my connectors, so I can delegate a subtask without a human.
- As an orchestrator agent, I want to prompt a child session and watch its event stream, so I can react to `agent_settled` and continue.
- As an operator, I want the injected auth to be scoped and revocable, so a misbehaving session can't escalate beyond the platform's own API.

## Acceptance criteria

- Session launch adds `AGENT_LAND_URL` and `AGENT_LAND_BASIC_AUTH` to the container env when enabled.
- The injected credentials authenticate against the JSON/SSE API as a scoped platform identity, not the operator's full basic auth.
- A session can create, prompt, and observe a child session using only the injected env vars.
- No new primitive: this is env injection plus the existing API — see [engine.md](/reference/engine.md#loopback).

## Open questions

- Is the injected identity per-session (ephemeral, dies with the session) or per-platform (shared operator role)?
- Should injection be default-on for every session, or opt-in per `al new`/`al run`?
