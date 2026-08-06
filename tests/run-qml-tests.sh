#!/usr/bin/env bash
# Proves the shared ES modules load and execute in Qt's QML engine.
# Exit 0 = pass. Exit 10+N = assertion N failed. Exit 2 = a module failed to load.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! command -v qml6 >/dev/null 2>&1; then
    echo "error: qml6 not found (install qt6-declarative)" >&2
    exit 127
fi

# `|| code=$?` is required: under `set -e` a bare failing command aborts the
# script before the exit code can be captured, losing the diagnostic below.
code=0
QT_QPA_PLATFORM=offscreen qml6 "$HERE/qml/shared-smoke.qml" || code=$?
if [ "$code" -eq 0 ]; then
    echo "QML shared-module smoke test passed"
else
    echo "QML shared-module smoke test FAILED (exit $code)" >&2
fi
exit "$code"
