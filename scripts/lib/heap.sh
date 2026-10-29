#!/bin/bash
# lib/heap.sh —— 容器资源（内存/CPU）探测，被 build.sh / dev.sh / start.sh source。
# 内存：cgroup v2 -> v1 -> /proc/meminfo（裸机回退）；容器内 /proc/meminfo 读宿主机，不可直接用。
# CPU：cgroup v2 cpu.max -> v1 cfs_quota -> nproc；os.cpus()/nproc 读宿主机核数，会高估容器配额。
# 内存非法/超限值一律 clamp 到 [场景下限, 可用内存-系统余量]，不 exit；余量留给不受堆参数约束的原生内存（Turbopack 等）。
# 注意：算出的是「单进程」堆上限。NODE_OPTIONS 会被所有子进程继承，故 build 场景已按进程数分摊。

# 读取容器可用内存上限（MB），cgroup 优先
read_mem_limit_mb() {
  local mb=""
  local v
  # cgroup v2
  if [[ -r /sys/fs/cgroup/memory.max ]]; then
    v=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo "")
    [[ "$v" =~ ^[0-9]+$ ]] && mb=$((v / 1024 / 1024))
  # cgroup v1（无限制时是极大值，需过滤）
  elif [[ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]]; then
    v=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo "")
    [[ "$v" =~ ^[0-9]+$ ]] && (( v < 1099511627776 )) && mb=$((v / 1024 / 1024))
  fi
  # 裸机回退
  if [[ -z "$mb" || "$mb" -le 0 ]]; then
    local kb
    kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 2097152)
    mb=$((kb / 1024))
  fi
  echo "$mb"
}

# 读取容器 CPU 配额（核数，向上取整），cgroup 优先；os.cpus()/nproc 读宿主机核数会高估配额
read_cpu_limit() {
  local cpus=""
  local quota period
  # cgroup v2：cpu.max 格式 "quota period"（如 "200000 100000" = 2 核），"max" 为无限制
  if [[ -r /sys/fs/cgroup/cpu.max ]]; then
    quota=$(awk '{print $1}' /sys/fs/cgroup/cpu.max 2>/dev/null || echo "")
    period=$(awk '{print $2}' /sys/fs/cgroup/cpu.max 2>/dev/null || echo "")
    if [[ "$quota" =~ ^[0-9]+$ && "$period" =~ ^[0-9]+$ && "$period" -gt 0 ]]; then
      cpus=$(( (quota + period - 1) / period ))
    fi
  # cgroup v1：cfs_quota_us / cfs_period_us，quota=-1 为无限制
  elif [[ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us && -r /sys/fs/cgroup/cpu/cpu.cfs_period_us ]]; then
    quota=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null || echo "")
    period=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null || echo "")
    if [[ "$quota" =~ ^[0-9]+$ && "$period" =~ ^[0-9]+$ && "$period" -gt 0 ]]; then
      cpus=$(( (quota + period - 1) / period ))
    fi
  fi
  # 回退 nproc（无 cgroup 配额时，如无限制容器）；至少 1 核
  if [[ -z "$cpus" || "$cpus" -le 0 ]]; then
    cpus=$(nproc 2>/dev/null || echo 1)
  fi
  (( cpus < 1 )) && cpus=1
  echo "$cpus"
}

# build worker 进程数 = min(CPU 配额, 可用内存/2G)。与 RAYON_NUM_THREADS 刻意区分：
# rayon 是共享一份原生内存的线程池，只看 CPU；worker 是独立 Node 进程、各带一份 V8 堆，须同时受内存约束。
read_build_cpus() {
  local cpus mem by_mem
  cpus=$(read_cpu_limit)
  mem=$(read_mem_limit_mb)
  by_mem=$(( mem / 2048 ))
  (( by_mem < 1 )) && by_mem=1
  (( cpus > by_mem )) && cpus=$by_mem
  echo "$cpus"
}

# 按场景计算 V8 堆上限（MB，单进程值）：compute_heap_mb <build|dev|start> [平台注入值]
# 平台注入值优先，仍被 clamp 到 [floor, ceiling]。ceiling = min(hard_cap, 场景绝对上限 cap)：
# Mark-Compact 是全堆压缩、停顿随存活堆增长，大内存容器不能按百分比无限放大单堆。
compute_heap_mb() {
  local scene="$1"
  local injected="${2:-}"
  local avail
  avail=$(read_mem_limit_mb)

  # hard_cap = 可用内存 - 系统余量（留给原生内存与 OS）。余量按 12% 保留，封顶 512、兜底 128。
  local reserve=$(( avail * 12 / 100 ))
  (( reserve > 512 )) && reserve=512
  (( reserve < 128 )) && reserve=128
  local hard_cap=$(( avail - reserve ))
  (( hard_cap < 256 )) && hard_cap=256

  local target floor cap
  case "$scene" in
    dev)
      # dev 长跑：HMR 模块图与应用缓存使 V8 堆持续增长；原生内存另由 RAYON_NUM_THREADS 约束
      target=$(( avail * 40 / 100 ))
      floor=1024
      cap=9999
      ;;
    build)
      # NODE_OPTIONS 被主进程与每个 worker 各自继承，必须按 (1+worker数) 分摊，否则总量击穿配额
      local procs budget
      procs=$(( $(read_build_cpus) + 1 ))
      budget=$(( hard_cap / procs ))
      (( budget < 256 )) && budget=256
      target=$(( avail * 50 / 100 / procs ))
      floor=512
      cap=$budget
      ;;
    start|*)
      # 生产单进程、无 Turbopack 原生内存，可比 dev 宽
      target=$(( avail * 50 / 100 ))
      floor=512
      cap=4096
      ;;
  esac

  local ceiling=$hard_cap
  (( cap < ceiling )) && ceiling=$cap
  (( floor > ceiling )) && floor=$ceiling

  if [[ -n "$injected" && "$injected" =~ ^[0-9]+$ ]]; then
    target="$injected"
  fi

  (( target < floor )) && target=$floor
  (( target > ceiling )) && target=$ceiling
  echo "$target"
}
