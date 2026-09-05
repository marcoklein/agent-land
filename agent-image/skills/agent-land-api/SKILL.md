---
name: agent-land-api
description: Create, prompt, and watch child agent-land sessions via the platform's JSON/SSE API. Active when AGENT_LAND_URL and AGENT_LAND_BASIC_AUTH are set.
---

# agent-land-api — spawn and watch child sessions

You are running *inside* an agent-land session. The platform injects two env vars you can use to talk back to it:

- `AGENT_LAND_URL` — the base URL of the platform API (no trailing slash).
- `AGENT_LAND_BASIC_AUTH` — your **scoped, ephemeral** credential, in the form `session-<id>:<token>`. It authenticates only the JSON/SSE API and dies with your session. Never log it.

Your own session id is the `<id>` inside `AGENT_LAND_BASIC_AUTH`:

```bash
MY_SESSION_ID="${AGENT_LAND_BASIC_AUTH%%:*}"          # "session-<id>"
MY_SESSION_ID="${MY_SESSION_ID#session-}"
```

All calls below use `curl -u "$AGENT_LAND_BASIC_AUTH"` (basic auth) and return JSON.

## Create a child session

```bash
curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
  -X POST "$AGENT_LAND_URL/api/sessions" \
  -H 'Content-Type: application/json' \
  -d '{
    "connectors": ["github"],
    "model": "deepseek-v4-pro",
    "platform": true,
    "parentSessionId": "'"$MY_SESSION_ID"'"
  }'
```

- `platform: true` gives the child the same loopback ability (nested orchestration); omit it to keep the child platform-blind.
- `parentSessionId` records lineage — the child shows up under your id in `al ls --tree`.
- Capture the response's `session.id` — you need it for every later call.

## Prompt the child

```bash
curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
  -X POST "$AGENT_LAND_URL/api/sessions/$CHILD_ID/prompt" \
  -H 'Content-Type: application/json' \
  -d '{"message": "Summarize README.md and report the result"}'
```

The prompt is queued; the session runs asynchronously.

## Watch until the child settles

```bash
curl -sS -N -u "$AGENT_LAND_BASIC_AUTH" \
  "$AGENT_LAND_URL/api/sessions/$CHILD_ID/events?live=1"
```

Streams `data: {…}` SSE frames (note the `data: ` prefix — strip it before parsing with `jq`). Watch for two event types:

- `{"type":"message_end","message":{...}}` — carries the assistant's final message for the turn (the text blocks are the answer).
- `{"type":"agent_settled"}` — the agent is idle again; the turn is done. **React to this**, not to stream silence.

> **GOTCHA:** this stream never closes on `agent_settled` — it only closes when the session is **stopped**. A bare `curl -N` hangs forever. Always break on the settle marker (or bound the stream with `timeout` + poll `GET /api/sessions/:id`).

## Fetch the result

Two options:

```bash
# 1. From the settle loop — extract the last message_end text (preferred; you already have it)
# 2. Re-read the session record (status/envelope only — the transcript text is not in the record)
curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/sessions/$CHILD_ID"
```

For a one-shot child, this minimal loop prints the final message and exits on settle:

```bash
curl -sS -N -u "$AGENT_LAND_BASIC_AUTH" \
  "$AGENT_LAND_URL/api/sessions/$CHILD_ID/events?live=1" \
  | jq --unbuffered -R -c 'select(startswith("data: ")) | .[6:] | fromjson |
       (select(.type == "message_end") |
          (.message.content
            | if type == "array" then .[].text? // empty
              elif type == "string" then .
              else empty end)),
       (select(.type == "agent_settled") | "SETTLED")' \
  | { while IFS= read -r line; do [ "$line" = '"SETTLED"' ] && break; printf '%s\n' "$line"; done; }
```

## Stop the child when done

```bash
curl -sS -u "$AGENT_LAND_BASIC_AUTH" -X DELETE "$AGENT_LAND_URL/api/sessions/$CHILD_ID"
```

This kills (if still running) and removes the child; its ephemeral credential is invalidated.

## Notes

- The injected credential is **session-scoped**: it cannot create connectors/providers beyond what a normal client can, and it stops working the moment your session is killed or deleted.
- The API is the canonical machine interface — never screen-scrape; use the JSON/SSE endpoints.
