#!/usr/bin/env bash
# Canonical runner for the shared JS core. gjs is the source of truth; node is
# a convenience for quick loops when gjs is not on PATH.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if command -v gjs >/dev/null 2>&1; then
    exec gjs -m "$HERE/shared/run-all.mjs"
elif command -v node >/dev/null 2>&1; then
    echo "warning: gjs not found, falling back to node (not authoritative)" >&2
    exec node "$HERE/shared/run-all.mjs"
else
    echo "error: neither gjs nor node available" >&2
    exit 127
fi
