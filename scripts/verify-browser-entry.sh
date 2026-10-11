#!/usr/bin/env bash
# 浏览器真实验收：公共入口与最小测试脚本（2026-10-13）
#
# 背景：沙箱确认无 playwright / puppeteer / chromium / chrome（which 与 node_modules 双通道实证），
# 390px 手机 / 768px 平板 / 1440px 桌面真实浏览器交互验收无法在沙箱内执行。
# 本脚本供外部浏览器（用户自有环境）完成验收，并在沙箱内提供可自检的服务端探活项。
#
# 用法：
#   bash scripts/verify-browser-entry.sh            # 沙箱内服务端探活自检（不依赖浏览器）
#
# 外部浏览器验收步骤见本文件末尾「外部浏览器操作清单」注释，或运行:
#   bash scripts/verify-browser-entry.sh guide
set -uo pipefail

MODE="${1:-check}"

# ---- 沙箱公共入口（由平台环境变量推导，不硬编码域名） ----
if [ -n "${CODER_PROJECTS_DOMAIN:-}" ]; then
  PUBLIC_BASE="https://${CODER_PROJECTS_DOMAIN#https://}"
else
  PUBLIC_BASE="http://localhost:${DEPLOY_RUN_PORT:-5173}"
fi
LOCAL_BASE="http://localhost:${DEPLOY_RUN_PORT:-5173}"

pass=0; fail=0
check() { # check <描述> <期望值> <实际值>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "PASS  $1"; else fail=$((fail+1)); echo "FAIL  $1 (expect=$2 got=$3)"; fi
}

case "$MODE" in
guide)
  sed -n '/外部浏览器操作清单/,$p' "$0" | sed '1,2d'
  exit 0
  ;;
check)
  echo "== 浏览器验收 · 服务端探活自检 =="
  echo "公共入口: $PUBLIC_BASE"
  echo "本地探活: $LOCAL_BASE"
  echo

  echo "-- 入口页面探活（桌面/移动 SSR 均应 200） --"
  for p in / /student /student/quiz /student/reports /student/anatomy /auth/error /about/agent; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$LOCAL_BASE$p")
    check "GET $p" 200 "$code"
  done
  echo

  echo "-- 匿名 API 门控（未登录应全部 401，不泄露业务数据） --"
  for p in /api/auth/me /api/cases /api/sessions /api/teacher/students /api/quiz/questions; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$LOCAL_BASE$p")
    check "GET $p (匿名)" 401 "$code"
  done
  echo

  echo "-- viewport meta（390px 真实渲染前提，SSR 输出必须包含） --"
  for p in / /student; do
    # 退出码口径：显式保存 curl 退出码，不依赖管道末端 grep 的状态（grep -c ... || true 会掩盖 curl 失败）
    body=$(curl -s --max-time 8 "$LOCAL_BASE$p"); curl_rc=$?
    if [ "$curl_rc" -ne 0 ]; then
      check "viewport meta present in $p" "curl-ok" "curl_rc=$curl_rc"
    else
      n=$(printf '%s' "$body" | grep -c '<meta name="viewport" content="width=device-width, initial-scale=1"' || true)
      check "viewport meta present in $p" 1 "$n"
    fi
  done
  echo

  echo "-- 响应式断点存在性（CSS 静态审计，非浏览器验收替代） --"
  css="src/app/globals.css"
  n=$(grep -c '@media (max-width: 699px)' "$css" || true)
  check "手机断点 (max-width:699px) 规则组" 5 "$n"
  n=$(grep -c '@media (min-width: 700px)' "$css" || true)
  check "平板+断点 (min-width:700px) 规则组" 1 "$n"
  n=$(grep -c '@media (min-width: 1024px)' "$css" || true)
  check "桌面断点 (min-width:1024px) 规则组" 1 "$n"
  n=$(grep -c '@media (prefers-reduced-motion: reduce)' "$css" || true)
  check "reduced-motion 适配" 1 "$n"
  echo

  echo "结果: $pass PASS / $fail FAIL"
  echo "注意: 以上仅为服务端可验项。真实浏览器交互（点击/软键盘/视觉回归/视口切换）"
  echo "      需按「外部浏览器操作清单」在外部浏览器完成，沙箱内不可替代。"
  [ "$fail" -eq 0 ]
  ;;
*)
  echo "用法: bash scripts/verify-browser-entry.sh [check|guide]"; exit 2 ;;
esac

# ===================== 外部浏览器操作清单（文档，不执行） =====================
# 本节为外部浏览器（390px 手机 / 768px 平板 / 1440px 桌面）真实验收操作清单。
# 公共入口: 见上方 PUBLIC_BASE（平台预览域名）。
#
# 一、入口与登录
#   1. 打开公共入口 /，确认教师入口与学生入口两张卡片可辨识。
#   2. 学生入口使用演示学生账号（凭据位于 /workspace/.demo-secrets/，仅验收人员领取）登录。
#   3. 快捷登录（超星 OAuth）仅点击发起，跳转至超星授权页即算通过（回调不验）。
#
# 二、病例列表（/student）
#   1. 390px: 卡片单列堆叠、无横向滚动条、无文字溢出遮挡；768px: 双列；
#      1440px: 布局带侧边导航。
#   2. 分类筛选 + 关键词搜索 + 清空按钮 + 空结果态 + 分页（每页 12 项）逐一点击。
#   3. 最近选择区：登录后出现，刷新/退出重登后保留；换另一账号登录不显示前一账号记录。
#
# 三、病例详情（预览卡）
#   1. 预览卡仅显示目录元数据（名称/学科/星级/来源/年龄性别/症状线索），不含诊断答案。
#   2. OSCE/guided/immersive 三种模式入口可正常发起跳转。
#   3. 缺独立来源病例（新生儿脑梗死/支气管肺炎/格林巴利）OSCE 入口禁用（aria-disabled）。
#
# 四、会话行为
#   1. 训练中刷新页面，最近记录与会话状态保留。
#   2. 退出重登后最近记录保留（按账号隔离）。
#
# 五、计时验证
#   1. 从登录到定位任一目标病例（搜索与分类两条路径），记录真人操作耗时（目标 ≤30 秒）。
#   2. 沙箱内自动化计时（0.39–0.93ms）仅证明检索逻辑即时响应，不能替代真人计时。
#
# 六、边界合规
#   1. 列表与预览卡不出现患者正文、未脱敏媒体。
#   2. 测试会话标记（account_kind=test 的统计探针账号）保留不删。
#
# 已验（沙箱服务端）: 入口页面 200×7、匿名 API 401×5、viewport meta、
# 响应式断点规则组存在（静态审计口径）。
# 未验（需外部浏览器）: 真实交互点击、软键盘、视觉回归、视口切换、真人 30 秒计时、
# 真实教师 OAuth 回调、双账号并发写竞争、完整临床流程。
