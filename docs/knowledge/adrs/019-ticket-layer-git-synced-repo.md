---
status: proposed
date: 2026-09-14
tags: [product, dogfooding, orchestration, tickets, hitd, playbook]
deciders: [agent]
---

# Keep the Ticket Layer in a Separate Git-Synced Repo

**Decision:** Track work state — the queue, phase labels, dependencies, per-ticket HITD artifacts, and handoff thoughts — in a dedicated git-native repo (`agent-land-tickets`, tickets as markdown + YAML frontmatter via `tk`), not in `agent-land`; use `git pull --rebase` / `git push` as the synchronization layer, where a failed push invalidates the local action.

**Why:** A work queue is *shared mutable state*, but git branches are divergent copies, so a queue living in `agent-land` fragments across feature branches; `agent-land`'s `main` is protected with no path-based bypass, so a status change (`tk start`) would need a full PR; and low-value status churn would pollute code-PR diffs. A separate push-to-main repo gives one truth for the loop while `agent-land` stays the gated home of durable OKF product memory and code. This is the beads model (git remote as sync) realized with plain git + small markdown files, so it stays inside the vim test (plain text, no database, single operator).

**Alternatives considered:** Tickets in `agent-land` `.tickets/` — rejected because branch divergence fragments the queue and protected `main` makes status churn a PR each. GitHub Issues as the only backend — rejected as the system of record because state lives off-repo (not plain text), dependency graphs are weak, and intake/handoff context fragments from OKF memory; kept only as a collaboration ref via `external-ref`. beads (Dolt) / beads_rust (SQLite) — rejected because a database contradicts ADR 008 and the no-database boundary. Heavy PM suites (Plane, Huly, OpenProject) — rejected as multi-user servers with Postgres/Mongo + auth, failing the vim test on three counts.
