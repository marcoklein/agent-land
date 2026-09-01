# Learnings

Operational and empirical findings that live here because the code can't express them.

* [pi `--mode rpc` harness](pi-rpc.md) — how agent-land drives pi headless, and its exec-stream lifecycle semantics
* [SSE over the hosted edge proxy](hosted-sse.md) — proxy buffering, heartbeats, and gapless replay/dedupe
* [Session lifecycle & redeploy resilience](session-lifecycle.md) — what survives a redeploy and how sessions recover
* [Deployment gotchas](deployment.md) — Dokku + SOPS build-time and host-setup bugs
* [Inspiration from Archon](archon-inspiration.md) — what to borrow from Archon's workflow-engine approach, and what to refuse
* [Agent Land and Archon — how they compose](archon-composition.md) — recipe layer vs runtime, and where they overlap
