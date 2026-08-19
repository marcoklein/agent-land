#!/bin/bash
# Vendor static assets into public/
# Pin versions here — bump them to update.
set -euo pipefail

HTMX_VERSION="4.0.0-beta6"
PICO_VERSION="2.1.1"

HTMX_BASE="https://cdn.jsdelivr.net/npm/htmx.org@${HTMX_VERSION}/dist"
PICO_BASE="https://cdn.jsdelivr.net/npm/@picocss/pico@${PICO_VERSION}"

DIR="$(cd "$(dirname "$0")/.." && pwd)/packages/server/public"

echo "=== Vendoring vendor assets to $DIR ==="

# ---- htmx ----
echo "htmx.org ${HTMX_VERSION}"
curl -sfL -o "$DIR/htmx.js"          "$HTMX_BASE/htmx.js"
curl -sfL -o "$DIR/htmx.min.js"      "$HTMX_BASE/htmx.min.js"
curl -sfL -o "$DIR/hx-sse.js"        "$HTMX_BASE/ext/hx-sse.js"
curl -sfL -o "$DIR/hx-sse.min.js"    "$HTMX_BASE/ext/hx-sse.min.js"

# ---- Pico CSS ----
echo "Pico CSS ${PICO_VERSION}"
curl -sfL -o "$DIR/pico.min.css"     "$PICO_BASE/css/pico.min.css"

echo "=== Done ==="