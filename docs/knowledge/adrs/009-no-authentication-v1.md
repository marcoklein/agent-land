---
status: accepted
date: 2026-07-27
tags: [security, auth]
deciders: [marcoklein]
---

# No Authentication in v1

**Decision:** Ship without authentication. The orchestrator runs on a trusted server behind SSH or internal network.

**Why:** Single-user personal tool. SOPS/Age encryption protects secrets at rest. Docker container isolation separates agent runs.

**Note:** HTTP basic auth is enabled at the Dokku level for public deployments.

**Alternatives considered:** OAuth2, API keys — rejected because they add friction for a single-user personal tool. HTTP basic auth at the Dokku level (not application code) was chosen for the public deployment.
