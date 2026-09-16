---
status: accepted
date: 2026-07-31
tags: [architecture, connectors, secrets, ux]
deciders: [marcoklein]
---

# Secrets Embedded in Connector Form

**Decision:** The secret is no longer a separate entity managed on its own page. Users paste secret YAML directly in the connector creation form. The SOPS-encrypted file is auto-generated from the connector name (slugified).

**Why:** 1:1 connector↔secret makes separate management unnecessary ceremony and eliminates the orphaned-connector problem. Deleting a connector deletes its secret file. The user flow changed from two-step to one-step (paste the secret YAML inline); `/secrets` routes and views are removed; `SopsService` is still used internally.

**Alternatives considered:** Shared secrets across connectors, secret rotation UI — rejected because 1:1 is the only use case right now; rotation can be done by deleting and re-creating the connector.
