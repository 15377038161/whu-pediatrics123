#!/usr/bin/env bash
# 沙箱 dev server 持久重启（基于 dev-restart.log 实证命令：pnpm exec next dev -H 0.0.0.0 -p $DEPLOY_RUN_PORT）。
#
# 场景：coder init 平台托管的 coder dev 进程退出/沙箱会话恢复后，需要自行拉起 dev server
# 供浏览器验收脚本访问 http://localhost:$DEPLOY_RUN_PORT。日志统一落 /workspace/projects/dev-restart.log
# （标准日志目录规范，勿写到 /tmp）。
#
# 用法：bash scripts/sandbox-dev-restart.sh          # 重启并探活
#       bash scripts/sandbox-dev-restart.sh status   # 仅查看状态
# 边界：绝不触碰 9000 端口（系统保留）；仅按端口 LISTEN 精确匹配杀本服务进程。
set -euo pipefail

PORT="${DEPLOY_RUN_PORT:-5173}"
LOG="/workspace/projects/dev-restart.log"
cd "$(dirname "$0")/.."

listen_pid() { # 输出端口 LISTEN 进程 PID（本沙箱无 ss/fuser/lsof，实测 netstat -tlnp 可用；
  # 端口后接空白锚定，避免 5173 误配 51730 等子串；仅取 LISTEN 行的 pid/进程名）
  netstat -tlnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p"$" && $6 == "LISTEN" { split($7, a, "/"); print a[1]; exit }'
}

case "${1:-restart}" in
status)
  pid="$(listen_pid || true)"
  if [ -n "${pid:-}" ]; then
    echo "dev server 运行中 pid=$pid port=$PORT"
    curl -s -o /dev/null -w "GET / -> %{http_code}\n" --max-time 8 "http://localhost:$PORT/" || true
  else
    echo "dev server 未监听 port=$PORT"
  fi
  exit 0
  ;;
restart)
  pid="$(listen_pid || true)"
  if [ -n "${pid:-}" ]; then
    echo "[restart] 端口 $PORT 已有监听进程 pid=$pid，先停止"
    kill "$pid"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 1
      [ -z "$(listen_pid || true)" ] && break
    done
    if [ -n "$(listen_pid || true)" ]; then
      echo "[restart] 优雅停止超时，强制 kill -9 $pid"
      kill -9 "$pid" || true
      sleep 1
    fi
  fi
  echo "[restart] 后台启动: pnpm run dev（端口 $PORT，日志 $LOG）"
  ( nohup pnpm run dev > "$LOG" 2>&1 & )
  # 探活：最长等 120s（Turbopack 冷编译首页可达数秒）
  ok=0
  for _ in $(seq 1 60); do
    sleep 2
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$PORT/" || true)"
    if [ "$code" = "200" ]; then ok=1; break; fi
  done
  if [ "$ok" = "1" ]; then
    echo "PASS dev server 就绪: http://localhost:$PORT (GET / 200)"
  else
    echo "FAIL dev server 120s 内未就绪，检查 $LOG（tail -n 50 $LOG）"
    exit 1
  fi
  ;;
*)
  echo "用法: bash scripts/sandbox-dev-restart.sh [restart|status]"; exit 2 ;;
esac
