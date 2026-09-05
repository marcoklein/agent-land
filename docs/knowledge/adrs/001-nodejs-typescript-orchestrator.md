---
status: accepted
date: 2026-07-27
tags: [runtime, language]
deciders: [marcoklein]
---

# Node.js/TypeScript for Orchestrator

**Decision:** Build the orchestrator in Node.js + TypeScript.

**Why:** Same ecosystem as the pi coding agent (Node.js package), Dockerode provides native Docker API access, Express + EJS is the most mature HTMX-compatible stack in Node.js.

**Alternatives considered:** Python/FastAPI, Go — rejected because polyglot overhead not worth it when the agent runtime is already Node.js.
