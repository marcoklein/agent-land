---
type: Reference
title: OpenCode API
description: Zen vs Go products, endpoints, auth behavior, and model listing.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-07-31T00:00:00Z }
updated: { by: opencode/deepseek-v4-pro, at: 2026-07-31T00:00:00Z }
sources:
  - id: opencode-docs
    resource: https://opencode.ai/docs
    title: OpenCode API documentation
  - id: opencode-go-docs
    resource: https://opencode.ai/docs/go
    title: OpenCode Go subscription docs
  - id: opencode-repo
    resource: https://github.com/anomalyco/opencode
    title: OpenCode GitHub repository
---

# Zen vs Go

OpenCode operates two separate products through the same API gateway:

| | Zen | Go |
|---|---|---|
| **Product** | Main OpenCode provider | Paid subscription for curated open models |
| **Pricing** | Bring your own API keys | $5 first month, then $10/month |
| **Model count** | 60 | 23 |
| **Provider families** | Claude, GPT, Gemini, Grok, DeepSeek, GLM, MiniMax, Kimi, Qwen | DeepSeek, Kimi, GLM, MiniMax, Qwen, MiMo, Grok, Hy |
| **pi provider id** | `opencode` | `opencode-go` |
| **Models endpoint** | `GET /zen/v1/models` (public) | `GET /zen/go/v1/models` (public) |
| **Chat endpoint** | `POST /zen/v1/responses` | `POST /zen/go/v1/chat/completions` (OpenAI-compat) or `POST /zen/go/v1/messages` (Anthropic-compat) |

Both are accessed through `https://opencode.ai/zen/v1/` and `https://opencode.ai/zen/go/v1/` respectively.

In the OpenCode TUI, option `opencode` (Zen) has priority 0 — "(Recommended)", and `opencode-go` (Go) has priority 1 — "Low cost subscription for everyone".

The wrong base URL `https://api.opencode.ai` returns `"Not Found"` (HTTP 200) for all paths except `/` (which returns `"Hello, world!"`).

# Endpoints

## Zen: List all models

```
GET https://opencode.ai/zen/v1/models
```

Returns 60 models across all providers. **No authentication required.**[^opencode-docs] Response format is OpenAI-compatible (`{ object: "list", data: [...] }`).

Models include: `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.1-codex`, `gemini-3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `grok-4.5`, `qwen3.6-plus`, `big-pickle`, and 48 others.

## Go: List all models

```
GET https://opencode.ai/zen/go/v1/models
```

Returns 23 Go-specific models. **No authentication required.** Same response format as Zen (`{ object: "list", data: [...] }`).

Official Go models per docs:[^opencode-go-docs] `grok-4.5`, `glm-5.2`, `glm-5.1`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `deepseek-v4-pro`, `deepseek-v4-flash`, `mimo-v2.5`, `mimo-v2.5-pro`, `hy3`.

Overlap with Zen: `deepseek-v4-pro`, `deepseek-v4-flash`, `grok-4.5`, some GPT, MiniMax, Kimi, GLM, Qwen models.

Go-only models: `qwen3.7-max`, `qwen3.7-plus`, `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2.5-pro`, `hy3`, `hy3-preview`.

## Go: Chat completions (OpenAI-compatible)

```
POST https://opencode.ai/zen/go/v1/chat/completions
Authorization: Bearer <api_key>
```

Used for Go models compatible with OpenAI SDK (`@ai-sdk/openai-compatible`): Grok, GLM, Kimi, DeepSeek, MiMo, Hy.

## Go: Messages (Anthropic-compatible)

```
POST https://opencode.ai/zen/go/v1/messages
x-api-key: <api_key>
```

Used for Go models compatible with Anthropic SDK (`@ai-sdk/anthropic`): MiniMax, Qwen.

## Zen: Chat completions

```
POST https://opencode.ai/zen/v1/responses
Authorization: Bearer <api_key>
```

Zen's unified chat endpoint. Requires API key (format `sk-...`).

# Auth

- `/zen/v1/models`, `/zen/go/v1/models`: **public** — no auth needed
- `/zen/go/v1/chat/completions`: Bearer `api_key`
- `/zen/go/v1/messages`: `x-api-key` header
- `/zen/v1/responses`: Bearer `api_key`

# Impact on agent-land

## Model discovery

Both Zen and Go model listing endpoints are public — no SOPS decryption needed for model fetching.

Agent Land currently uses `opencode-go` (Go subscription). The model dropdown in the launch form fetches from `GET https://opencode.ai/zen/go/v1/models` at page render time and caches the result.

## Provider fix needed

The Docker command hardcodes `--provider opencode` but the container environment injects the Go API key (`OPENCODE_API_KEY`) and Go URL (`OPENCODE_API_URL`). This mismatch should be fixed: change `--provider opencode` to `--provider opencode-go` to match the credentials being passed.

[^opencode-docs]: OpenCode API documentation
[^opencode-go-docs]: OpenCode Go subscription docs
