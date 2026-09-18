# Features

* [Platform Connector](platform-connector.md) — session self-injection of `AGENT_LAND_URL`/`AGENT_LAND_BASIC_AUTH` so agents can spawn child sessions
* [Mount](mount.md) — a durable named folder attached to a session, outliving any single session
* [Ticket layer](ticket-layer.md) — `agent-land-tickets` as the git-synced system of record the loop drives: phase-label funnel, HITD artifacts, reconciliation
* [Scheduled maintenance](scheduled-maintenance.md) — weekly dep-bump + stale-PR triage cron, the generic-cron counterpart to the pipeline-ready trigger
