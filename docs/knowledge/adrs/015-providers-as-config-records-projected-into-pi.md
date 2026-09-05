---
status: accepted
date: 2026-08-19
tags: [providers, llm, architecture, secrets]
deciders: [marco]
---

# 15. Providers are config records projected into pi

**Decision:** Multi-provider LLM support is implemented as persisted provider records (`data/providers.json`) plus SOPS secrets (`secrets/provider-<id>.yaml`) that agent-land projects into pi's three native mechanisms — env vars, `models.json`, and `auth.json` — instead of reimplementing any LLM routing in agent-land.

**Why:** pi 0.82.1 already ships a complete, validated provider layer, so agent-land's only job is to manage records and credentials and materialize pi's config files per container, which keeps the provider surface configurable without per-provider code changes.

**Alternatives considered:** A dedicated provider client layer in agent-land, and discovery via `pi --list-models` — rejected because a client layer duplicates pi's routing and risks drift, and `--list-models` only emits a human-facing table and requires secrets inside a container before discovery.
