#!/usr/bin/env bash
# Monitor the agent-land pipeline orchestrator session automatically.
# Usage: ./scripts/watch-orchestrator.sh <session-id> [interval-seconds]
# Env overrides: AGENT_LAND_URL, AGENT_LAND_BASIC_AUTH (falls back to .env in the repo root)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SESSION_ID="${1:?usage: watch-orchestrator.sh <session-id> [interval]}"
INTERVAL="${2:-90}"
if [ -n "${AGENT_LAND_BASIC_AUTH:-}" ]; then
  AUTH="$AGENT_LAND_BASIC_AUTH"
else
  AUTH="$(grep AGENT_LAND_BASIC_AUTH "$REPO_ROOT/.env" | cut -d= -f2-)"
fi
URL="${AGENT_LAND_URL:-https://agent-land.host.impromat.app}"
CLI="$REPO_ROOT/packages/cli/dist/agent-land.js"

RFC3339() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

last_sig=""

echo "[watch] monitoring $SESSION_ID every ${INTERVAL}s (Ctrl-C to stop)"

while true; do
  # Session status + tree
  status="$(curl -sS -m 10 -u "$AUTH" "$URL/api/sessions/$SESSION_ID" \
    | jq -r '.session.status // "?"' 2>/dev/null)"
  children="$(curl -sS -m 10 -u "$AUTH" "$URL/api/sessions" \
    | jq -r '[.sessions[] | select(.parentSessionId=="'"$SESSION_ID"'") | (.id+"["+.status+"]")] | join(" ") ' 2>/dev/null)"

  # Full event history for this session
  events="$(curl -sS -m 15 -u "$AUTH" "$URL/api/sessions/$SESSION_ID/events" 2>/dev/null)"

  # Extract signals from the persisted events
  last_settled="$(printf '%s' "$events" | jq -R -s -r '
    [ split("\n")[] | select(startswith("data: ")) | .[6:] | fromjson?
      | select(.type=="agent_settled") ] | length' 2>/dev/null)"

  # Assistant text from the last message_end (the orchestrator's latest narration)
  last_text="$(printf '%s' "$events" | jq -R -s -r '
    [ split("\n")[] | select(startswith("data: ")) | .[6:] | fromjson?
      | select(.type=="message_end") | (.message.content
          | if type=="string" then .
            elif type=="array" then [.[] | .text? // empty] | join("\n")
            else empty end) ] | .[-1] // ""' 2>/dev/null)"

  # Signals to flag
  null_sig="RESULT: null\|sse size: 5\|result: null\|empty research"
  done_sig="Pipeline complete\|gate 1 passed\|gate 2 passed"

  flag=""
  if printf '%s' "$last_text" | grep -qiE "$null_sig"; then flag="[NULL-RESULT]"; fi
  if [ "$status" = "waiting_for_input" ]; then flag="[PARKED-AT-GATE]"; fi
  if printf '%s' "$last_text" | grep -qiE "$done_sig" || [ "$status" = "stopped" ]; then flag="[DONE]"; fi

  sig="$flag|$status|$(printf '%s' "$last_text" | md5 -q 2>/dev/null || cksum)"
  if [ "$sig" != "$last_sig" ]; then
    echo "$(RFC3339) status=$status children=[$children] settles=$last_settled $flag"
    if [ -n "$last_text" ]; then
      echo "          └─ $(printf '%s' "$last_text" | tr '\n' ' ' | cut -c1-240)"
    fi
    last_sig="$sig"
  else
    echo "$(RFC3339) ...no change (status=$status $flag)"
  fi

  # Alarm on terminal states
  case "$flag" in
    *DONE*) [ -x "$CLI" ] && node "$CLI" log "$SESSION_ID" 2>/dev/null | tail -6; break ;;
    *PARKED*) echo ">>> parked — awaiting gate decision" ;;
  esac

  sleep "$INTERVAL"
done
