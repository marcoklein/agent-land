---
okf_version: "0.2"
---

# Reference

* [CLI (`al`)](cli.md) — install, configure, and drive agent-land from the terminal
* [Providers](providers/) — LLM backends: API behaviors, model discovery, auth
* [Learnings](learnings/) — operational gotchas: pi exec-stream lifecycle, hosted SSE, redeploy resilience

## Testing

Tests use vitest + supertest with a page object pattern. No mocks for SOPS — a dedicated test age key encrypts fixtures at runtime. See `packages/server/src/__tests__/` for the test suite.
