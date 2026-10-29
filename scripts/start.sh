#!/bin/bash
set -Eeuo pipefail

CODER_PROJECTS_PATH="${CODER_PROJECTS_PATH:-$(pwd)}"


PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


cd "${CODER_PROJECTS_PATH}" || {
    echo "ERROR: 工作目录不存在 -> ${CODER_PROJECTS_PATH}" >&2
    exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/heap.sh"

# 自证生产环境，不依赖平台注入（漏注入会退化成 dev 模式致内存暴涨）
export CODER_PROJECT_ENV=PROD

AVAIL_MB=$(read_mem_limit_mb)
MAX_HEAP_MB=$(compute_heap_mb start "${MAX_HEAP_MB:-}")

# 端口合法性校验
if ! [[ "${DEPLOY_RUN_PORT}" =~ ^[0-9]+$ ]] || [[ "${DEPLOY_RUN_PORT}" -lt 1 ]] || [[ "${DEPLOY_RUN_PORT}" -gt 65535 ]]; then
    echo "ERROR: DEPLOY_RUN_PORT 端口非法，必须 1~65535" >&2
    exit 1
fi

echo "========================================"
echo "Service start config:"
echo "Workdir:    ${CODER_PROJECTS_PATH}"
echo "Listen Port:${DEPLOY_RUN_PORT}"
echo "Node Heap:  ${MAX_HEAP_MB} MB (container available: ${AVAIL_MB}MB, cgroup-aware)"
echo "Project Env:${CODER_PROJECT_ENV}"
echo "========================================"
echo "Starting HTTP service..."

PORT="${DEPLOY_RUN_PORT}" CODER_PROJECT_ENV=PROD NODE_OPTIONS="--max-old-space-size=${MAX_HEAP_MB}" node dist/server.js