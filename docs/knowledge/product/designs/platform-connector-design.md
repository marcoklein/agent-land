---
type: Design
title: Platform Connector
description: Design for the loopback primitive: per-session ephemeral credentials injected as AGENT_LAND_URL / AGENT_LAND_BASIC_AUTH, session lineage, and server-side auth for the JSON/SSE API.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T14:35:31Z }
sources:
  - id: feature
    resource: /product/features/platform-connector.md
    title: Platform Connector Feature note
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the purest form
  - id: architecture
    resource: /architecture.md
    title: Agent Land architecture — the zoom ladder
  - id: roadmap
    resource: /multi-agent-workflow.md
    title: Multi-agent workflow — Phase 1
  - id: adr-008
    resource: /adrs/008-json-files-no-database.md
    title: JSON files on mounted volume instead of a database
  - id: adr-009
    resource: /adrs/009-no-authentication-v1.md
    title: No authentication in v1
  - id: adr-014
    resource: /adrs/014-json-api-canonical-machine-interface.md
    title: JSON API is the canonical machine interface
  - id: session-service
    resource: packages/server/src/core/session-service.ts
    title: Session lifecycle and capability injection
  - id: contracts
    resource: packages/contracts/src/session.ts
    title: Session contracts (zod)
  - id: config
    resource: packages/server/src/config.ts
    title: Server config (env-driven)
---

# Platform Connector

The loopback primitive[^engine]: at session creation the engine injects its own address and a **scoped, ephemeral** credential into the container, turning every platform-enabled agent into a first-class client of the JSON/SSE API[^adr-014]. No new engine primitive — env injection plus the existing API, exactly the composition loop in the architecture zoom ladder[^architecture].

## Approach

Two halves: (1) **loopback credentials** minted per session and (2) **lineage** recorded on the session. Both are create-time resolutions (engine invariant #2) and both live in the flat-JSON session record (ADR 008)[^adr-008].

At `createSession`, when the caller opts in (`platform: true`), the service:

1. Mints a 32-byte `base64url` token (`platformToken`).
2. Stores it on the session record — so it survives a server redeploy and re-attach, like everything else in the record.
3. Injects `AGENT_LAND_URL` (from server config) and `AGENT_LAND_BASIC_AUTH=session-<id>:<token>` into the container env, alongside connector/provider env.
4. Accepts that credential in a new server-side auth middleware, and **invalidates it** by clearing `platformToken` when the session is killed or marked stopped.

The token is the only secret this feature adds, and it never crosses the wire as a field: the API strips `platformToken` before serializing any session.

## Answers to the Feature note's open questions

1. **Per-session or per-platform identity?** **Per-session, ephemeral.** Each platform session gets its own `session-<id>:<token>` identity that dies with the session. No shared operator role is ever placed inside a container, so a misbehaving session can only talk to the platform API as *itself*, and its access disappears the moment it is killed or deleted[^feature][^roadmap].
2. **Default-on or opt-in?** **Opt-in** (`al new --platform` / `platform: true` on `POST /api/sessions`), default off. Keeps the blast radius small; sessions that don't orchestrate get no loopback credential[^roadmap].

## Interfaces

**Contracts** (`packages/contracts/src/session.ts`):

- `createSessionInputSchema` gains `platform?: boolean` (default false) and `parentSessionId?: string`.
- `sessionSchema` gains `platform?: boolean` and `parentSessionId?: string`. Both are returned on every GET/list; `platform` is serialized as an explicit boolean (`true`/`false`), `parentSessionId` only when present.

**Server config** (`packages/server/src/config.ts`):

- `agentLandUrl` — from `AGENT_LAND_URL`; defaults to `http://localhost:${PORT}`. Operators must set it to an address reachable *from inside sibling containers* (e.g. `http://host.docker.internal:3000` on the host, or the public URL); `localhost` resolves to the container, not the host.
- `operatorBasicAuth` — the operator credential for the new middleware, from `AGENT_LAND_BASIC_AUTH` (`user:password`) or `AGENT_LAND_AUTH_USER`/`AGENT_LAND_AUTH_PASSWORD` — the same convention the CLI already uses.

**Auth** (`packages/server/src/presentation/http/auth.ts`):

Minimal middleware on `/api/*` accepting two identities:

- the operator basic-auth credential, when configured, and
- a session credential `session-<id>:<token>`, verified against the session record's `platformToken`.

Comparisons are constant-time. **Tradeoff (documented per the issue):** HTTP auth previously terminated at nginx only (ADR 009 — trusted network)[^adr-009]. This adds application-level auth for the JSON/SSE API. When `operatorBasicAuth` is **unset**, requests without an `Authorization` header still pass through (preserving the trusted-network deployment), but session credentials are accepted either way — so the loopback works even on an unauthenticated dev server. When set, the header becomes mandatory and must be operator or session. The tradeoff is that the token must be compared in Node (not nginx), which is why the comparison is constant-time and the middleware is deliberately tiny.

**Session service** (`packages/server/src/core/session-service.ts`):

- `createSession` accepts `platform`/`parentSessionId`, mints and injects the credential.
- `kill` and `markStopped` clear `platformToken` (revocation on stop/deletion).

**CLI** (`packages/cli/src`):

- `--platform` on `al new` and `al run`, forwarded as `platform: true`.
- `al ls --tree` renders sessions grouped under their parent (`parentSessionId`), with box-drawing indentation. Tree mode sorts chronologically; the flat list stays newest-first.

**Bundled skill** (`agent-image/skills/agent-land-api/SKILL.md`):

Teaches a session the create → prompt → watch-SSE → react-to-`agent_settled` loop with `curl`/`jq` against `$AGENT_LAND_URL`, authenticated with `$AGENT_LAND_BASIC_AUTH`. The session derives its own id (for `parentSessionId`) from the `session-<id>` prefix of its credential.

## Risks & mitigations

- **`localhost` unreachable from containers** → default `agentLandUrl` is a footgun for orchestrators running in sibling containers. Documented and operator-overridable; the design note is the mitigation until Phase 2 proves a better default.
- **Token at rest in plain JSON** → ADR 008 forbids a database[^adr-008]; the token is stored beside the session it belongs to, like connector secret *references* (values stay in SOPS). Acceptable because it is ephemeral, scoped to one session's loopback, and revoked on stop/delete. A leaked token is useless once the session is gone.
- **Timing attacks on basic-auth compare** → constant-time comparison for both identities.
- **Dangling lineage** → `parentSessionId` is accepted opaquely (no existence check); `al ls --tree` renders missing parents as roots. Avoids a lookup per create; a validation pass can be added if dangling ids become noisy.
- **Token leak via API** → `platformToken` is stripped in `publicSession()` before every session serialization; the field name is server-internal only.

## ADR pointers

No new ADR: env injection is existing engine behavior (ADR 004/006 patterns), storage stays flat-JSON (ADR 008), and the auth middleware is a *narrow amendment* to ADR 009 rather than a reversal — it only enforces when an operator credential is configured, and only adds the session-credential path the loopback requires. Flag ADR 009 for an explicit amendment if server-side auth is judged architecturally significant.

## Minimal change set

- `packages/contracts/src/session.ts` — `platform`/`parentSessionId` on input + record.
- `packages/server/src/config.ts` — `agentLandUrl`, `operatorBasicAuth`, `parseBasicAuthValue`.
- `packages/server/src/presentation/http/auth.ts` — new middleware (`parseAuthorizationHeader`, `safeEqual`).
- `packages/server/src/core/types.ts` — `AgentSession.platformToken`, `PLATFORM_SESSION_PREFIX`.
- `packages/server/src/core/session-service.ts` — mint/inject/revoke + lineage.
- `packages/server/src/presentation/http/api-sessions.ts` — pass new fields, strip token.
- `packages/server/src/server.ts` — mount middleware.
- `packages/cli/src` — `--platform`, `al ls --tree` (`lib/tree.ts`).
- `agent-image/skills/agent-land-api/SKILL.md` — bundled skill.
- `.env.example` — document `AGENT_LAND_URL` / operator auth vars.
- Tests — credential minting/injection/revocation, auth middleware, lineage, tree rendering.

[^feature]: [Platform Connector Feature note](/product/features/platform-connector.md)
[^engine]: [Agent Land engine](/engine.md) — Loopback primitive
[^architecture]: [Agent Land architecture](/architecture.md) — composition loop
[^roadmap]: [Multi-agent workflow](/multi-agent-workflow.md) — Phase 1 decisions
[^adr-008]: [ADR 008 — flat JSON, no database](/adrs/008-json-files-no-database.md)
[^adr-009]: [ADR 009 — no authentication in v1](/adrs/009-no-authentication-v1.md)
[^adr-014]: [ADR 014 — JSON API is canonical](/adrs/014-json-api-canonical-machine-interface.md)
