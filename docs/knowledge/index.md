---
okf_version: "0.2"
---

# Knowledge

The single home for documentation and reference — every note is OKF with `status` and source citations. Nothing relevant to the platform lives outside this bundle.

* [Engine](engine.md) — the purest form: six primitives, three substrates, one engine opinion
* [Architecture](architecture.md) — the zoom ladder: the primitives as diagrams, from one turn to the deployed platform
* [CLI (`al`)](cli.md) — install, configure, and drive agent-land from the terminal
* [Providers](providers/) — LLM backends: API behaviors, model discovery, auth
* [Product](product/) — goals (vision + boundary), features, designs, and the pipeline
* [Learnings](learnings/) — operational gotchas and empirical findings
* [Dogfooding](dogfooding.md) — developing agent-land on agent-land
* [Decisions](adrs/) — architecture decision records

## Testing

Tests use vitest + supertest with a page object pattern. No mocks for SOPS — a dedicated test age key encrypts fixtures at runtime. See `packages/server/src/__tests__/` for the test suite.
