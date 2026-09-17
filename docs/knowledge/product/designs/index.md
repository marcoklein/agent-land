# Designs

Approved technical designs — the handoff from product to implementation. Each design is a PR-reviewed OKF note; merge of the design PR is the approval signal.

* [Mount](mount-design.md) — durable named folder, single-writer invariant, manual cleanup
* [Git identity injection](git-identity-design.md) — server injects `GIT_USER_NAME`/`GIT_USER_EMAIL` so agents commit without being told
* [Platform Connector](platform-connector-design.md) — per-session loopback credentials + lineage, so agents spawn and watch child sessions
* [Ticket layer](ticket-layer-design.md) — `agent-land-tickets` repo, tk schema, phase-label funnel, bash loop v1, sync protocol, gates, reconciliation
* [Engine-native scheduler](alt-daj9-engine-native-scheduler-design.md) — a platform-native external scheduler over the JSON/SSE API, keeping scheduling and orchestration outside the engine
