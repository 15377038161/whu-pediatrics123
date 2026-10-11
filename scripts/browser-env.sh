#!/usr/bin/env bash
# 浏览器验收环境变量（source 本文件后运行 scripts/verify-browser-*.mjs）。
# 路径与 2026-10-13 环境突破实证一致；/tmp 被清理后先运行 scripts/rebuild-browser-env.sh 重建。
# 用法：source scripts/browser-env.sh
export PW_CORE_PATH=/tmp/pwtest/node_modules/playwright-core
export PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers
# 注意：dbus 等包的库解包在 lib/x86_64-linux-gnu，X11/nss 等在 usr/lib/x86_64-linux-gnu——两个目录都必须包含。
export LD_LIBRARY_PATH=/tmp/pw-libs/usr/lib/x86_64-linux-gnu:/tmp/pw-libs/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/tmp/pwtest/fonts.conf
