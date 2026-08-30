---
status: proposed
date: 2026-08-30
tags: [architecture, cli, web, providers, connectors]
deciders: [agent]
---

# Strip Web UI and Vendor Knowledge from Server

**Decision:** Remove the server-rendered HTML UI, move provider/model selection to the CLI, and make connectors/providers generic records with no vendor-specific type enums or catalogs.

**Why:** The CLI is the primary interface; the web UI is unused, and baked-in vendor knowledge (provider catalog, connector field definitions) violates the "no technology baked into the platform" principle.

**Alternatives considered:** Keep web UI alongside CLI — rejected because it doubles the surface area and complicates the server with EJS, sessions, flash messages, and HTMX. Keep provider catalog on server — rejected because it embeds vendor knowledge that should be composable by the CLI.