---
okf_version: "0.2"
---

# Agent Land Knowledge

* [Providers](providers/) — LLM backends: API behaviors, model discovery, auth

## Testing

Tests use vitest + supertest with a page object pattern. No mocks for SOPS — a dedicated test age key encrypts fixtures at runtime. See `src/__tests__/` for the test suite.
