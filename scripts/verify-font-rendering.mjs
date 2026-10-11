/* 字体渲染可读性证据探针（非患者敏感内容口径）：
 * 背景：沙箱 chromium 无系统 CJK 字体，此前截图中文显示为方块占位。
 * 本轮解包 fonts-wqy-microhei（deb.debian.org 官方 deb）装入 /tmp/pw-libs/usr/share/fonts/wqy/
 * 并清理 fontconfig 缓存后，验证中文可正常渲染。
 * 证据页面仅取落地页 /（应用名 + 教师/学生入口卡，零患者内容），
 * 截图仅存本地 artifacts/font-evidence/，不上传云盘。
 * 环境要求同 verify-browser-interactive.mjs（PW_CORE_PATH / PLAYWRIGHT_BROWSERS_PATH /
 * LD_LIBRARY_PATH / FONTCONFIG_FILE）。
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BROWSER_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const OUT = 'artifacts/font-evidence';

let chromium;
try {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(process.env.PW_CORE_PATH ?? 'playwright-core'));
} catch (e) {
  console.error('FATAL playwright-core 不可用：' + (e instanceof Error ? e.message.split('\n')[0] : e));
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

for (const [w, h, label] of [[390, 844, '390px'], [1440, 900, 'desktop']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('button.login-entry-card-student', { timeout: 15000 });
    const title = await page.title();
    report(`${label} 落地页渲染`, title.length > 0, `title=${title}`);
    // 字体渲染探针：canvas 度量 CJK 字符宽度，方块占位（tofu）时宽度与缺字回退一致不可区分，
    // 改用 document.fonts.check 探测 fontconfig 是否提供 CJK 字族
    const cjk = await page.evaluate(() => {
      const span = document.createElement('span');
      span.style.cssText = 'position:absolute;visibility:hidden;font-family:sans-serif;font-size:32px;white-space:nowrap';
      span.textContent = '珞珈儿科智训教师入口学生入口';
      document.body.appendChild(span);
      const w = span.getBoundingClientRect().width;
      span.remove();
      return w;
    });
    // 11 个全角 CJK 字符在 32px 下正常渲染宽度应 ≈ 11×32=352px；tofu 方块同样等宽，
    // 因此宽度仅作记录，可读性以人工核对截图为准（非患者页面可直接查看）
    report(`${label} CJK 文本渲染宽度`, cjk > 11 * 20, `width=${Math.round(cjk)}px (11字@32px)`);
    // 强判定：两个不同汉字分别离屏渲染为位图并比较像素。tofu（.notdef 方块）下任意字符
    // 像素完全一致；像素存在差异 ⇒ 渲染的是真实字形而非占位方块。无需人工看图即可证明可读。
    const glyphDiff = await page.evaluate(() => {
      const draw = (ch) => {
        const canvas = document.createElement('canvas');
        canvas.width = 48; canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.font = '32px sans-serif';
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'top';
        ctx.fillText(ch, 8, 8);
        return ctx.getImageData(0, 0, 48, 48).data;
      };
      const a = draw('永'), b = draw('康');
      let diff = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff += 1;
      return diff;
    });
    report(`${label} CJK 真实字形（非tofu方块）`, glyphDiff > 100, `差异像素=${glyphDiff}（0=方块占位一致）`);
    await page.screenshot({ path: `${OUT}/landing-${label}.png`, fullPage: false });
  } catch (e) {
    report(`${label} 落地页流程`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
  }
  await page.close();
}
await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`SUMMARY ${pass}/${results.length}`);
console.log(`截图目录: ${OUT}/（本地保存，不上传云盘）`);
process.exit(pass === results.length ? 0 : 1);
