---
type: Learnings
title: Adding a custom API key provider — two traps and the fixes
description: pi expects `{type: "api_key", key}` in auth.json and strips `/v1` from SDK baseUrls; both were wrong, both are now fixed in the server.
status: draft
generated: { by: opencode/qwen3.8-max, at: 2026-09-13T17:10:00Z }
sources:
  - id: pi-auth-schema
    resource: node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js
    title: pi auth.json credential schema
  - id: pi-anthropic-client
    resource: node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js
    title: pi anthropic-messages client (wraps @anthropic-ai/sdk)
  - id: provisioner
    resource: packages/server/src/infra/pi-config-provisioner.ts
    title: agent-land auth.json / models.json rendering
  - id: provider-service
    resource: packages/server/src/core/provider-service.ts
    title: provider record seeding (apiKey → secret Yaml)
---

# Adding a custom API key provider — two traps and the fixes

Bringing your own LLM backend to agent-land exposes two integration gaps between agent-land's provider abstraction and how pi resolves credentials and constructs HTTP requests. Both are now fixed in the server; this note records what went wrong so the contract stays documented.

## Trap 1 — auth.json entry shape

agent-land writes provider credentials into pi's `/tmp/pi-config/auth.json`. For an API key provider the code was emitting:

```json
{ "qwencloud": { "apiKey": "sk-...", "baseUrl": "...", "api": "anthropic-messages" } }
```

pi's `AuthStorage.read()` demands a different shape[^pi-auth-schema]:

```json
{ "qwencloud": { "type": "api_key", "key": "sk-..." } }
```

- `type` must be `"api_key"` (otherwise pi skips the credential without an error).
- The field is `key`, not `apiKey`.

Because the old entry had neither `type` nor `key`, pi's `getAuth` returned `undefined` → `"Provider is not configured: qwencloud"`. OAuth providers (github-copilot) written `{type:"oauth",...}` were already correct; only API key providers were broken.

**Fix:** `providerEntryFromEnv` now returns `{ type: "api_key", key: <literal> }`. Done in [pi-config-provisioner.ts](/packages/server/src/infra/pi-config-provisioner.ts).

## Trap 2 — base URL and the @anthropic-ai/sdk doubling `/v1`

pi-ai's anthropic-messages implementation wraps `new Anthropic({ baseURL: model.baseUrl })`[^pi-anthropic-client]. The Anthropic JS SDK internally composes `${baseURL}/v1/messages`. When the provider's base URL already ends with `/v1` (e.g. `.../apps/anthropic/v1`), the effective request URL becomes `.../v1/v1/messages` → 404.

The same base URL works fine with the Vercel AI SDK (`@ai-sdk/anthropic`) because that client manages `/v1/messages` differently and does not double it.

**Rule:** when configuring a provider whose backend is an Anthropic-compatible MaaS endpoint, strip the trailing `/v1` from the `baseUrl` — the SDK adds it back.

Fix applied to the qwencloud provider record via `al providers rm` / `al providers add`; no code change needed. The [CLI reference](/platform/cli.md) should warn about this, but the on-disk contract between agent-land and pi is:

> `baseUrl` is passed directly to the SDK's `baseURL` option. If the SDK appends its own versioned path, the provider record must not include that path segment.

## Model discovery offline

The qwencloud endpoint (`token-plan.ap-southeast-1.maas.aliyuncs.com`) does not expose a `GET /models` endpoint (returns 404). The model list must be supplied statically in the provider record via `--models`. The `model-catalog`'s `discoverFromProvider` gracefully falls back to the static list when discovery fails[^model-catalog], so runtime is unaffected.

## Verification

After both fixes, a smoke session succeeds:

```bash
al run "Reply with exactly: ok" --provider qwencloud --model deepseek-v4-pro --rm
# → ok
```

The default provider (opencode-go via `OPENCODE_API_KEY` env) and OAuth providers (github-copilot via `{type:"oauth"}`) are unchanged by these fixes.

[^pi-auth-schema]: `@earendil-works/pi-coding-agent/dist/core/auth-storage.js` — `AuthStorage.read()` checks `credential?.type !== "api_key"` and resolves `credential.key`.
[^pi-anthropic-client]: `@earendil-works/pi-ai/dist/api/anthropic-messages.js` — constructs `new Anthropic({ baseURL: model.baseUrl, ... })`; the SDK hardcodes `/v1/messages` on every request.
[^model-catalog]: `packages/server/src/infra/model-catalog.ts` — `discoverFromProvider` returns `provider.models ?? []` when discovery fails.