# Designs

Approved technical designs — the handoff from product to implementation. Each design is a PR-reviewed OKF note; merge of the design PR is the approval signal.

* [Mount](mount-design.md) — durable named folder, single-writer invariant, manual cleanup
* [Git identity injection](git-identity-design.md) — server injects `GIT_USER_NAME`/`GIT_USER_EMAIL` so agents commit without being told
* [Platform Connector](platform-connector-design.md) — per-session loopback credentials + lineage, so agents spawn and watch child sessions
* [Ticket layer](ticket-layer-design.md) — `agent-land-tickets` repo, tk schema, phase-label funnel, bash loop v1, sync protocol, gates, reconciliation
* [Self-hosting sessions](self-hosting-sessions-design.md) — the container runner owns pi's stdio; a deploy never interrupts a running session
* [Self-hosting sessions P1 — a replaceable session runtime](self-hosting-sessions-p1-design.md) — the container runner owns pi's stdio; a second `AgentHarness` implementation; exec stays default
* [Scheduled maintenance](scheduled-maintenance-design.md) — one weekly workflow, two idempotent jobs: within-range dep-bump PR + stale-PR triage, human-gated
