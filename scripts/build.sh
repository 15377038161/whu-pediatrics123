#!/bin/bash
set -Eeuo pipefail

CODER_PROJECTS_PATH="${CODER_PROJECTS_PATH:-$(pwd)}"
echo "Working directory: ${CODER_PROJECTS_PATH}"
cd "${CODER_PROJECTS_PATH}" || { echo "ERROR: 目录不存在 ${CODER_PROJECTS_PATH}" >&2; exit 1; }

# 引入统一堆探测库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/heap.sh"

# 堆上限为单进程值（MAX_HEAP_MB 注入优先，仍被 clamp），heap.sh 已按 (1+worker数) 分摊
AVAIL_MB=$(read_mem_limit_mb)
MAX_HEAP_MB=$(compute_heap_mb build "${MAX_HEAP_MB:-}")
BUILD_ENV="NODE_OPTIONS=--max-old-space-size=${MAX_HEAP_MB}"

# RAYON/TURBO 按 CPU 配额（共享一份原生内存的线程池）；NEXT_BUILD_CPUS 另受内存约束（独立进程各带 V8 堆）
CPU_LIMIT=$(read_cpu_limit)
BUILD_CPUS=$(read_build_cpus)
export RAYON_NUM_THREADS="${CPU_LIMIT}"
export TURBO_TASKS_AVAILABLE_PARALLELISM="${CPU_LIMIT}"
export NEXT_BUILD_CPUS="${BUILD_CPUS}"

echo "Build Node heap ceiling: ${MAX_HEAP_MB}MB per process x $(( BUILD_CPUS + 1 )) procs (container available: ${AVAIL_MB}MB, cgroup-aware)"
echo "Build parallelism: workers=${BUILD_CPUS} rayon_threads=${CPU_LIMIT} (container CPU quota)"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --reporter=append-only

BUILD_START=${SECONDS}
echo "Building the Next.js project..."
env ${BUILD_ENV} pnpm next build

echo "Bundling server with tsup..."
env ${BUILD_ENV} pnpm tsup src/server.ts --format cjs --platform node --target node24 --outDir dist --no-splitting --no-minify
echo "Build duration: $(( SECONDS - BUILD_START ))s"

du -sh .next dist 2>/dev/null || true

# 构建后断言：验证客户端生产 sourcemap 已关闭（仅 WARN 不中断构建）
echo "Running post-build assertions..."
if [[ -d .next/static ]]; then
  CLIENT_MAP_COUNT=$(find .next/static -name '*.map' 2>/dev/null | wc -l | tr -d ' ')
else
  CLIENT_MAP_COUNT=0
fi
if [[ "${CLIENT_MAP_COUNT}" -gt 0 ]]; then
  echo "WARN: .next/static 下发现 ${CLIENT_MAP_COUNT} 个 .map 文件，productionBrowserSourceMaps 可能未生效" >&2
else
  echo "OK: 客户端生产 sourcemap 已关闭（.next/static 无 .map）"
fi

echo "Build completed successfully!"
