#!/bin/bash
set -Eeuo pipefail


PORT=5000
CODER_PROJECTS_PATH="${CODER_PROJECTS_PATH:-$(pwd)}"
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-${PORT}}"


cd "${CODER_PROJECTS_PATH}"

# 引入统一堆探测库，按 dev 场景计算堆上限（比例与上限见 heap.sh）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/heap.sh"
DEV_HEAP_MB=$(compute_heap_mb dev "${MAX_HEAP_MB:-}")
export NODE_OPTIONS="--max-old-space-size=${DEV_HEAP_MB}"
echo "Dev Node heap ceiling: ${DEV_HEAP_MB}MB (container available: $(read_mem_limit_mb)MB, cgroup-aware)"

# 限制 Turbopack 原生（rayon）并行度到容器 CPU 配额：原生内存不受 NODE_OPTIONS 约束，实测占 dev RSS 约 87%
CPU_LIMIT=$(read_cpu_limit)
export RAYON_NUM_THREADS="${CPU_LIMIT}"
export TURBO_TASKS_AVAILABLE_PARALLELISM="${CPU_LIMIT}"
echo "Dev Turbopack parallelism: RAYON_NUM_THREADS=${CPU_LIMIT} TURBO_TASKS_AVAILABLE_PARALLELISM=${CPU_LIMIT} (container CPU quota)"

# 缓存体积超阈值提示清理
if [[ -d .next/dev/cache ]]; then
  CACHE_MB=$(du -sm .next/dev/cache 2>/dev/null | cut -f1)
  if [[ -n "${CACHE_MB}" && "${CACHE_MB}" -gt 512 ]]; then
    echo "WARN: .next/dev/cache 已达 ${CACHE_MB}MB（>512MB），建议执行 pnpm clean 清理" >&2
  fi
fi

# 取监听 DEPLOY_RUN_PORT 的 PID 列表（空格分隔，无监听则为空串）
listening_pids() {
  ss -H -lntp 2>/dev/null \
    | awk -v port="${DEPLOY_RUN_PORT}" '$4 ~ ":"port"$"' \
    | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true
}

kill_port_if_listening() {
    local pids
    pids=$(listening_pids)
    if [[ -z "${pids}" ]]; then
      echo "Port ${DEPLOY_RUN_PORT} is free."
      return
    fi
    echo "Port ${DEPLOY_RUN_PORT} in use by PIDs: ${pids} (SIGKILL)"
    echo "${pids}" | xargs -I {} kill -9 {}
    sleep 1
    pids=$(listening_pids)
    if [[ -n "${pids}" ]]; then
      echo "Warning: port ${DEPLOY_RUN_PORT} still busy after SIGKILL, PIDs: ${pids}"
    else
      echo "Port ${DEPLOY_RUN_PORT} cleared."
    fi
}

echo "Clearing port ${DEPLOY_RUN_PORT} before start."
kill_port_if_listening
echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for dev..."

# 直调 tsx 绕开 pnpm 包装层（省常驻内存）；--exclude 防 .next 产物触发 watch 重启循环
PORT=${DEPLOY_RUN_PORT} node ./node_modules/tsx/dist/cli.mjs watch --clear-screen=false --exclude ".next/**" src/server.ts \
1> >(
  while IFS= read -r line || [[ -n "$line" ]]; do
    ts="$(TZ=Asia/Shanghai date +"%Y-%m-%d %H:%M:%S")"
    echo "${ts} [INFO] ${line}" >> app.log
    # [mem] 行镜像到本脚本 stdout（平台捕获为 dev.log），使配置行与内存指标同处一文件。
    # '[mem]' 必须加引号：裸 [mem] 在 [[ == ]] 里是字符类，会误匹配 m/e 开头的行。
    if [[ "${line}" == '[mem]'* ]]; then
      echo "${ts} ${line}"
    fi
  done
) \
2> >(
  while IFS= read -r line || [[ -n "$line" ]]; do
    echo "$(TZ=Asia/Shanghai date +"%Y-%m-%d %H:%M:%S") [ERROR] $line" >> app.log
  done
)