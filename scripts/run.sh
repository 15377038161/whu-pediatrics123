#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Match src/server.ts and the platform's injected preview port.
SERVICE_PORT="${DEPLOY_RUN_PORT:-${PORT:-5173}}"
if ! [[ "$SERVICE_PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$SERVICE_PORT < 1 || 10#$SERVICE_PORT > 65535 )); then
  echo "Invalid preview port" >&2
  exit 1
fi
export DEPLOY_RUN_PORT="$SERVICE_PORT"
export PORT="$SERVICE_PORT"
export HOST="0.0.0.0"
# This is the .coze dev/preview runner, not the production deploy runner.
# Bind only newly created preview sessions to the registered private teaching edition.
export PEDIATRICS_TRAINING_RECOVERY="object-storage"
export PEDIATRICS_TRAINING_PREFER_LOCAL="1"

# A reconstructed sandbox has no ignored build files. Keep the custom server's
# OAuth redirect handling, without depending on .preview or killing other services.
if [[ ! -f .next/BUILD_ID || ! -f dist/server.js ]]; then
  pnpm build
fi
exec node dist/server.js
