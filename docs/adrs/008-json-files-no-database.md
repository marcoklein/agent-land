---
status: accepted
date: 2026-07-27
tags: [storage, persistence]
deciders: [marcoklein]
---

# JSON Files on Mounted Volume Instead of a Database

**Decision:** Store agent runs, connector definitions, and session data as flat JSON files on a Docker volume. No SQLite or other database.

**Why:** No database dependency simplifies deployment and operation. Agent runs are write-once-read-infrequently. Connectors fit in a single JSON array. The orchestrator reads pi session files directly from the shared volume.

**Alternatives considered:** SQLite, PostgreSQL — rejected because the data volume is tiny (connectors + run metadata) and read patterns are simple; a database adds migration and connection management overhead.
