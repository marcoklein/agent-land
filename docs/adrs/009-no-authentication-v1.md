---
status: accepted
date: 2026-07-27
tags: [security, auth]
deciders: [marcoklein]
---

# No Authentication in v1

**Decision:** Ship without authentication. The orchestrator runs on a trusted server behind SSH or internal network.

**Why:** Personal tool on a trusted server. SOPS/Age encryption protects secrets at rest. Docker container isolation separates agent runs. HTTP basic auth can be added later via Dokku (~1 line) or middleware (~30 lines).

**Alternatives considered:** OAuth2, API keys, HTTP basic auth — rejected because they add friction for a single-user personal tool; basic auth is deferred to when the tool is exposed beyond the local network.
