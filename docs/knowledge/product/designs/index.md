# Designs

Approved technical designs — the handoff from product to implementation. Each design is a PR-reviewed OKF note; merge of the design PR is the approval signal.

* [Mount](mount-design.md) — durable named folder, single-writer invariant, manual cleanup
* [Git identity injection](git-identity-design.md) — server injects `GIT_USER_NAME`/`GIT_USER_EMAIL` so agents commit without being told
* [Platform Connector](platform-connector-design.md) — per-session loopback credentials + lineage, so agents spawn and watch child sessions
* [Ticket layer](ticket-layer-design.md) — `agent-land-tickets` repo, tk schema, phase-label funnel, bash loop v1, sync protocol, gates, reconciliation
* [Respond to Review](respond-to-review-design.md) — playbook recipe that reads review feedback via gh api, addresses each thread, pushes to the head branch, replies once per thread, re-requests review
