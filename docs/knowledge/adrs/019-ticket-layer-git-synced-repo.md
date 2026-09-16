---
status: proposed
date: 2026-09-14
tags: [tickets, hitd, playbook]
deciders: [agent]
---

# Keep the Ticket Layer in a Separate Git-Synced Repo

**Decision:** Track work state — queue, phase labels, dependencies, HITD artifacts, thoughts — as `tk` markdown in a dedicated `agent-land-tickets` repo, synced by `git pull --rebase` / `git push`; a failed push invalidates the action.

**Why:** A queue is shared mutable state, but git branches are divergent copies and agent-land's protected `main` would make every status change a PR; a separate repo gives the loop one truth and leaves agent-land as the gated home of OKF memory and code.

**Alternatives considered:** In-repo `.tickets/` — rejected: branches fragment the queue, protected main makes status churn a PR each. GitHub Issues alone — rejected: off-repo state, weak dependencies, context fragmented from OKF (kept as `external-ref`). beads/Dolt, SQLite — rejected: a database (ADR 008). Plane/Huly/OpenProject — rejected: multi-user servers, failing the vim test.
