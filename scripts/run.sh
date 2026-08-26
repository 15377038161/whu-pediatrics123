#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

EXPOSE_PORT=$(awk -F '[ =]+' '/^expose_port/ {gsub(/[^0-9]/, "", $2); print $2; exit}' .preview 2>/dev/null || echo 5000)
export PORT="$EXPOSE_PORT"

# Clean up stale process on the port (never touch 9000)
if [ "$EXPOSE_PORT" != "9000" ]; then
  OLD_PIDS=$(ss -lptn "sport = :${EXPOSE_PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true)
  for pid in $OLD_PIDS; do
    kill "$pid" 2>/dev/null || true
  done
  [ -n "$OLD_PIDS" ] && sleep 2
fi

exec pnpm exec next dev --hostname 0.0.0.0 --port "$EXPOSE_PORT"
