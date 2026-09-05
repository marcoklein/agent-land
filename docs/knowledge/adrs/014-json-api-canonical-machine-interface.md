---
status: accepted
date: 2026-08-18
tags: [api, cli, architecture]
deciders: [marco]
---

# 14. JSON API is the canonical machine interface

> **Note:** the "JSON API is canonical" half is more true than ever; the "EJS routes render HTML for the browser" half is dead — that was removed by [016 — Strip Web UI and Vendor Knowledge](016-strip-web-ui-and-vendor-knowledge.md), making `/api/*` the *only* surface.

**Decision:** All machine clients (CLI, scripts) talk to the server exclusively through JSON routers under `/api/*`; the EJS routes under `/routes/*` render HTML for the browser only.

**Why:** The `al` CLI and future automation must never depend on screen-scraping HTML pages. Connectors and models were only reachable through HTML forms, so JSON API routers were added (`/api/connectors`, `/api/models`) to achieve parity.

**Alternatives considered:** CLI scraping the HTML routes, a separate CLI-only server process — rejected because scraping is brittle, and a second server duplicates state ownership and auth.
