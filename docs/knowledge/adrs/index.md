# Decisions

Architecture Decision Records — the platform's design decisions as a numbered ledger. Each is an ADR (frontmatter `status`/`date`/`tags`/`deciders`), not an OKF concept note. `accepted` means the decision shipped; `deprecated` means superseded (see the inline pointer); `proposed` means not yet reviewed.

* [001 — Node.js + TypeScript orchestrator](001-nodejs-typescript-orchestrator.md) — build the orchestrator in Node.js + TypeScript
* [002 — Docker socket sibling containers](002-docker-socket-sibling-containers.md) — mount the socket to spawn sibling containers
* [003 — SOPS/Age secrets](003-sops-age-secrets.md) — encrypt secrets at rest, decrypt only at launch
* [004 — Connector model](004-connector-model.md) — a connector is a named pointer to a sealed secret, not a tool bundle
* [005 — Agent tool strategy](005-agent-tool-strategy.md) — pre-bake git/curl/jq/gh; install the rest at runtime
* [006 — Pi headless `--mode json`](006-pi-headless-json-mode.md) — **deprecated**, superseded by `pi --mode rpc`
* [007 — HTMX + Pico served locally](007-htmx4-pico-css-local.md) — **deprecated**, web UI removed in 016
* [008 — Flat JSON, no database](008-json-files-no-database.md) — flat files on a volume, no SQLite
* [009 — No authentication (v1)](009-no-authentication-v1.md) — trusted server, no in-app auth
* [010 — Secrets embedded in connectors](010-secrets-embedded-in-connectors.md) — paste secret YAML, auto-name the file
* [011 — Kill switch](011-kill-switch.md) — per-run timeout/tokens/cost limits
* [012 — Styling via Pico classes](012-styling-pico-no-inline.md) — **deprecated**, web UI removed in 016
* [013 — Real-time agent UI (HTMX4 SSE)](013-real-time-agent-ui-htmx4-sse.md) — **deprecated**, web UI removed in 016
* [014 — JSON API canonical machine interface](014-json-api-canonical-machine-interface.md) — machines talk JSON `/api/*`; the EJS half is superseded by 016
* [015 — Providers as config records projected into pi](015-providers-as-config-records-projected-into-pi.md) — provider records + SOPS secrets, no in-core LLM routing
* [016 — Strip web UI and vendor knowledge](016-strip-web-ui-and-vendor-knowledge.md) — remove the HTML UI and vendor catalogs
* [017 — Product layer on OKF memory](017-product-layer-okf-memory.md) — product knowledge as OKF, pipeline outside the engine
