---
status: accepted
date: 2026-07-27
tags: [architecture, connectors]
deciders: [marcoklein]
---

# Connector Model: Named Pointers to Secrets

**Decision:** A connector is a named pointer to a SOPS-encrypted secret file plus metadata (type, URL), not a tool bundle.

**Why:** Separates secret management from agent capabilities. Connectors are displayed in the UI without decrypting secrets. Tool definitions live in the agent image as SKILL.md files, not in the connector config.

**Alternatives considered:** Connector-as-tool-bundle, OAuth flows — rejected because tools are pre-baked in the agent image and installed at runtime; OAuth is overkill for personal API tokens.
