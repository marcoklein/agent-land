# Learnings

Operational and empirical findings that live here because the code can't express them.

* [pi `--mode rpc` harness](pi-rpc.md) — how agent-land drives pi headless, and its exec-stream lifecycle semantics
* [SSE over the hosted edge proxy](hosted-sse.md) — proxy buffering, heartbeats, and gapless replay/dedupe
* [Session lifecycle & redeploy resilience](session-lifecycle.md) — what survives a redeploy and how sessions recover
* [Deployment gotchas](deployment.md) — Dokku + SOPS build-time and host-setup bugs
* [Stale-document discovery](stale-document-discovery.md) — the staleness classes that drift in, and how mechanical detection keeps the base converging
* [Inspiration from Archon](archon-inspiration.md) — what to borrow from Archon's workflow-engine approach, and what to refuse
* [Agent Land and Archon — how they compose](archon-composition.md) — recipe layer vs runtime, and where they overlap
* [First dogfooding run (Phase 0)](first-dogfooding-run.md) — the first `al run` that opened a real agent-land PR, and the gaps it surfaced
* [Agent image staleness on deploy](agent-image-staleness.md) — deployed hosts keep the once-built agent image; skill changes don't reach sessions until it is rebuilt
* [Self-deploy hazard](self-deploy-hazard.md) — merges restart the platform your `al` runs live on; symptom, diagnosis, and resume-not-restart
* [Mount operations](mount-operations.md) — durable-checkout discipline: auto-created targets, single-writer guard in anger, sync-to-main rule
