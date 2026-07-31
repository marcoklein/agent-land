---
status: accepted
date: 2026-07-31
tags: [architecture, connectors, secrets, ux]
deciders: [marcoklein]
---

# Secrets Embedded in Connector Form

**Decision:** The secret is no longer a separate entity managed on its own page. Users paste secret YAML directly in the connector creation form. The SOPS-encrypted file is auto-generated from the connector name (slugified).

**Why:** 1:1 relationship between connectors and secrets means separate management is unnecessary ceremony. It also eliminates the orphaned-connector problem (connector pointing to a non-existent secret file). Deleting a connector deletes its secret file — no dangling references possible.

**What changed from ADR-004:** The "named pointer to secret" model remains internally (a `Connector` still has a `secretFile` field). But the user-facing model changed from two-step (create secret → create connector → wire together) to one-step (create connector with inline secret YAML). The `/secrets` routes and views are removed. `SopsService` is still used internally by the connector route.

**Alternatives considered:** Shared secrets across connectors, secret rotation UI — rejected because 1:1 is the only use case right now; rotation can be done by deleting and re-creating the connector.
