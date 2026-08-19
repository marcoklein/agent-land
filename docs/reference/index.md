---
okf_version: "0.2"
---

# Reference

* [CLI (`al`)](cli.md) — install, configure, and drive agent-land from the terminal
* [pi `--mode rpc` harness](pi-rpc.md) — how agent-land drives pi headless, and its exec-stream lifecycle semantics
* [SSE over the hosted edge proxy](hosted-sse.md) — proxy buffering, heartbeats, and gapless replay/dedupe
* [Session lifecycle & redeploy resilience](session-lifecycle.md) — what survives a redeploy and how sessions recover
* [Git workspace provisioning](workspace-git.md) — per-session checkout, `gh auth setup-git`, volume lifecycle
* [Providers](providers/) — LLM backends: API behaviors, model discovery, auth

## Testing

Tests use vitest + supertest with a page object pattern. No mocks for SOPS — a dedicated test age key encrypts fixtures at runtime. See `src/__tests__/` for the test suite.
