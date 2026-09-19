---
status: proposed
date: 2026-09-19
tags: [session, runtime, harness, deploy]
deciders: [agent]
---

# Make the Session Runtime Replaceable

**Decision:** Add a second `AgentHarness` (`RemoteAgentHarness`) that talks to a **runner** inside the agent container over an engine-internal channel, instead of owning pi's `docker exec` stream. The runner dials out (SSE downstream + JSON POST upstream, authed `session-<id>:<token>`), is the container entrypoint behind `SESSION_RUNTIME` (default `exec`), and owns the sequence + replay spool; the control plane keeps the observation log as the durable projection.

**Why:** Every merge deploys the platform and kills the exec stream it owns, so pi exits mid-turn — the self-hosting loop's own sessions die on every merge. Moving pi's stdio into the container is what makes a deploy harmless to running sessions.

**Amendments:** Control plane and session runtime get separate lifecycles; a runner is harness plumbing (like `entrypoint.sh`), not vendored technology — clarifying invariant #4.

**Alternatives considered:** control plane dials into the container (rejected — needs its address, re-dial per restart); a sidecar container (rejected — a second lifecycle, no gain); a control-plane-owned spool (rejected — the runner would re-derive state from the process being made disposable).
