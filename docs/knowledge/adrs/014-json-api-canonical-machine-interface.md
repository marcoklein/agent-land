---
status: accepted
date: 2026-08-18
tags: [api, cli, architecture]
deciders: [marco]
---

# 14. JSON API is the canonical machine interface

**Decision:** All machine clients talk to the server exclusively through JSON routers under `/api/*`; the HTML-facing EJS routes were removed by [ADR 016](016-strip-web-ui-and-vendor-knowledge.md), making `/api/*` the only surface.

**Why:** The `al` CLI and future automation must never depend on screen-scraping HTML pages. Connectors and models were only reachable through HTML forms, so JSON API routers were added (`/api/connectors`, `/api/models`) to achieve parity.

**Alternatives considered:** CLI scraping the HTML routes, a separate CLI-only server process — rejected because scraping is brittle, and a second server duplicates state ownership and auth.
