#!/bin/sh
set -e
mkdir -p /sessions /workspace
exec pi "$@"
