#!/usr/bin/env bash
# 沙箱无系统浏览器环境复建：playwright-core + chromium-headless-shell + 缺失共享库 + 字体（2026-10-13 环境突破的可复建版）
#
# 背景：沙箱无 root/sudo、无系统 chromium/chrome。真实浏览器验收依赖 /tmp 下手工搭建的运行环境，
# 而 /tmp 会被平台定期清理——本脚本把该环境复建为一条命令，路径与实际使用值完全一致（见
# docs/沙箱环境复建指南.md 与验收记录第七节「环境突破」）。
#
# 产物布局（与验收记录第七节实证一致）：
#   /tmp/pwtest/node_modules/playwright-core   playwright-core 1.56.1（PW_CORE_PATH）
#   /tmp/pw-browsers/chromium_headless_shell-1194  Chromium Headless Shell 141.0.7390.37（PLAYWRIGHT_BROWSERS_PATH）
#   /tmp/pw-libs/usr/lib/x86_64-linux-gnu/...  28 个 bookworm deb 解包共享库（LD_LIBRARY_PATH）
#   /tmp/pw-libs/usr/share/fonts/...           Liberation/DejaVu/文泉驿微米黑字体
#   /tmp/pwtest/fonts.conf                     FONTCONFIG_FILE（指向 /tmp/pw-libs 字体，缓存 /tmp/fontconfig-cache）
#
# 幂等：各步骤检测已有产物即跳过（--force 全部重建）。
# 用法：bash scripts/rebuild-browser-env.sh [--force]
# 自检：末尾以真实浏览器渲染 data: 页面验证链路可用（不依赖应用服务）。
set -euo pipefail

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1
if [ "$FORCE" -eq 1 ] && [ -d /tmp/pwtest -o -d /tmp/pw-browsers -o -d /tmp/pw-libs ]; then
  rm -rf /tmp/pwtest /tmp/pw-browsers /tmp/pw-libs /tmp/fontconfig-cache
  echo "[rebuild] --force：已清理既有 /tmp 环境目录"
fi

PW_CORE=/tmp/pwtest/node_modules/playwright-core
PW_LIBS=/tmp/pw-libs
PW_BROWSERS=/tmp/pw-browsers
FONTSCONF=/tmp/pwtest/fonts.conf

# ---- 工具自检 ----
for t in node pnpm curl dpkg-deb; do
  command -v "$t" >/dev/null 2>&1 || { echo "FATAL 缺少 $t"; exit 2; }
done

# ---- Step 1: playwright-core 1.56.1（版本与浏览器 build v1194 绑定，勿随意升级） ----
if [ -d "$PW_CORE" ]; then
  echo "[skip] playwright-core 已存在: $PW_CORE"
else
  echo "[step1] 安装 playwright-core@1.56.1 至 /tmp/pwtest（独立目录，不污染项目依赖）"
  mkdir -p /tmp/pwtest
  ( cd /tmp/pwtest && pnpm init >/dev/null 2>&1 && pnpm add playwright-core@1.56.1 >/tmp/pw-install.log 2>&1 )
  [ -d "$PW_CORE" ] || { echo "FATAL playwright-core 安装失败（见 /tmp/pw-install.log）"; exit 1; }
fi

# ---- Step 2: Chromium Headless Shell 141.0.7390.37（playwright build v1194） ----
if [ -d "$PW_BROWSERS/chromium_headless_shell-1194" ]; then
  echo "[skip] chromium-headless-shell 已存在: $PW_BROWSERS/chromium_headless_shell-1194"
else
  echo "[step2] 下载 chromium-headless-shell（约 104 MiB，源 cdn.playwright.dev）"
  mkdir -p "$PW_BROWSERS"
  PLAYWRIGHT_BROWSERS_PATH="$PW_BROWSERS" node "$PW_CORE/cli.js" install chromium-headless-shell > /tmp/pw-browser-dl.log 2>&1 \
    || { echo "FATAL 浏览器下载失败（见 /tmp/pw-browser-dl.log）"; exit 1; }
fi

# ---- Step 3: bookworm 依赖库解包（无 root：deb.debian.org 直连下载 + dpkg-deb -x 解包） ----
# 清单 = 2026-10-13 环境突破实测的 28 个包（libnss3/libglib 等运行库 + 字体包），pool 路径原样固化
DEB_PATHS=(
  pool/main/a/alsa-lib/libasound2_1.2.8-1+b1_amd64.deb
  pool/main/a/at-spi2-core/libatk-bridge2.0-0_2.46.0-5_amd64.deb
  pool/main/a/at-spi2-core/libatk1.0-0_2.46.0-5_amd64.deb
  pool/main/a/at-spi2-core/libatspi2.0-0_2.46.0-5_amd64.deb
  pool/main/d/dbus/libdbus-1-3_1.14.10-1~deb12u1_amd64.deb
  pool/main/g/glib2.0/libglib2.0-0_2.74.6-2+deb12u9_amd64.deb
  pool/main/libb/libbsd/libbsd0_0.11.7-2_amd64.deb
  pool/main/libd/libdrm/libdrm2_2.4.114-1+b1_amd64.deb
  pool/main/libx/libx11/libx11-6_1.8.4-2+deb12u2_amd64.deb
  pool/main/libx/libxau/libxau6_1.0.9-1_amd64.deb
  pool/main/libx/libxcb/libxcb1_1.15-1_amd64.deb
  pool/main/libx/libxcomposite/libxcomposite1_0.4.5-1_amd64.deb
  pool/main/libx/libxdamage/libxdamage1_1.1.6-1_amd64.deb
  pool/main/libx/libxdmcp/libxdmcp6_1.1.2-3_amd64.deb
  pool/main/libx/libxext/libxext6_1.3.4-1+b1_amd64.deb
  pool/main/libx/libxfixes/libxfixes3_6.0.0-2_amd64.deb
  pool/main/libx/libxi/libxi6_1.8-1+b1_amd64.deb
  pool/main/libx/libxkbcommon/libxkbcommon0_1.5.0-1_amd64.deb
  pool/main/libx/libxrandr/libxrandr2_1.5.2-2+b1_amd64.deb
  pool/main/libx/libxrender/libxrender1_0.9.10-1.1_amd64.deb
  pool/main/m/mesa/libgbm1_22.3.6-1+deb12u2_amd64.deb
  pool/main/n/nspr/libnspr4_4.35-1_amd64.deb
  pool/main/n/nss/libnss3_3.87.1-1+deb12u2_amd64.deb
  pool/main/w/wayland/libwayland-server0_1.21.0-1_amd64.deb
  pool/main/f/fontconfig/fontconfig-config_2.14.1-4_amd64.deb
  pool/main/f/fonts-dejavu/fonts-dejavu-core_2.37-6_all.deb
  pool/main/f/fonts-liberation/fonts-liberation_1.07.4-11_all.deb
  pool/main/f/fonts-wqy-microhei/fonts-wqy-microhei_0.2.0-beta-3.1_all.deb
)
if [ -f "$PW_LIBS/usr/lib/x86_64-linux-gnu/libnss3.so" ]; then
  echo "[skip] 依赖库已解包: $PW_LIBS"
else
  echo "[step3] 下载并解包 ${#DEB_PATHS[@]} 个 bookworm deb 至 $PW_LIBS"
  mkdir -p "$PW_LIBS" /tmp/pw-debs
  for p in "${DEB_PATHS[@]}"; do
    f="/tmp/pw-debs/${p##*/}"
    if [ ! -s "$f" ]; then
      curl -fsSL --retry 3 -o "$f" "http://deb.debian.org/debian/$p" \
        || { echo "FATAL 下载失败: $p"; exit 1; }
    fi
    dpkg-deb -x "$f" "$PW_LIBS"
  done
fi

# ---- Step 4: 字体配置（含中文文泉驿微米黑；缓存独立目录避免写系统路径） ----
if [ -f "$FONTSCONF" ]; then
  echo "[skip] fonts.conf 已存在: $FONTSCONF"
else
  echo "[step4] 写入 fonts.conf（字体目录 $PW_LIBS/usr/share/fonts，缓存 /tmp/fontconfig-cache）"
  mkdir -p /tmp/fontconfig-cache
  cat > "$FONTSCONF" <<'XML'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/tmp/pw-libs/usr/share/fonts</dir>
  <cachedir>/tmp/fontconfig-cache</cachedir>
</fontconfig>
XML
fi

# ---- Step 5: 自检：真实启动浏览器渲染 data: 页面（不依赖应用服务与凭据） ----
echo "[step5] 浏览器链路自检"
export PW_CORE_PATH="$PW_CORE"
export PLAYWRIGHT_BROWSERS_PATH="$PW_BROWSERS"
export LD_LIBRARY_PATH="$PW_LIBS/usr/lib/x86_64-linux-gnu:$PW_LIBS/lib/x86_64-linux-gnu"
export FONTCONFIG_FILE="$FONTSCONF"
node --input-type=module -e '
const { createRequire } = await import("node:module");
const require = createRequire(process.cwd() + "/");
const { chromium } = require(process.env.PW_CORE_PATH);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.goto("data:text/html,<h1>rebuild-ok</h1>");
const text = await page.textContent("h1");
await browser.close();
if (text !== "rebuild-ok") { console.error("FATAL 自检渲染异常: " + text); process.exit(1); }
console.log("SELF-TEST PASS chromium 启动+渲染正常");
' || { echo "FATAL 自检失败（检查上方错误与 LD_LIBRARY_PATH/FONTCONFIG_FILE）"; exit 1; }

echo
echo "== 环境就绪。运行浏览器验收脚本时导出以下环境变量（或 source scripts/browser-env.sh）： =="
cat <<ENV
export PW_CORE_PATH=$PW_CORE
export PLAYWRIGHT_BROWSERS_PATH=$PW_BROWSERS
export LD_LIBRARY_PATH=$PW_LIBS/usr/lib/x86_64-linux-gnu:$PW_LIBS/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=$FONTSCONF
ENV
