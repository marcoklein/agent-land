# Designs

Approved technical designs — the handoff from product to implementation. Each design is a PR-reviewed OKF note; merge of the design PR is the approval signal.

* [Mount](mount-design.md) — durable named folder, single-writer invariant, manual cleanup
* [Git identity injection](git-identity-design.md) — server injects `GIT_USER_NAME`/`GIT_USER_EMAIL` so agents commit without being told
* [Platform Connector](platform-connector-design.md) — per-session loopback credentials + lineage, so agents spawn and watch child sessions
* [Ticket layer](ticket-layer-design.md) — `agent-land-tickets` repo, tk schema, phase-label funnel, bash loop v1, sync protocol, gates, reconciliation
* [Self-hosting sessions](self-hosting-sessions-design.md) — the container runner owns pi's stdio; a deploy never interrupts a running session
* [Self-hosting sessions P1 — a replaceable session runtime](self-hosting-sessions-p1-design.md) — the container runner owns pi's stdio; a second `AgentHarness` implementation; exec stays default
* [Skills out of the agent image](skills-out-of-image-design.md) — deliver skills from a host-path mount the loop binds, not baked into the image
* [Design phase single copy](design-note-single-copy-design.md) — the design step writes only the agent-land OKF note and records the PR on the ticket, not a tickets design.md
* [Loop gate reconciliation](alt-sj6u-loop-gate-reconciliation-design.md) — the loop reads a parked ticket's PR and advances, closes, or unparks it; merge and comment become the only gate inputs
* [Schedule contract and loader](alt-jp4q-schedule-contract-loader-design.md) — the schedule file is JSON read by a standalone loader that emits one validated, normalized schedule list; a bad schedule fails at load, not at its first due tick
