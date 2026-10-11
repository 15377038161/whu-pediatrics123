/* 桌面查体遮罩修复回归验证（可复跑版）：
 * 背景：桌面 ≥1024px resume 至查体阶段会话时，全屏 mobile-drawer-backdrop 曾拦截点击
 * （修复提交 6352369：@media (min-width:1024px) 复位遮罩与抽屉样式）。
 *
 * 场景：
 *  A. Desktop 1440×900 新会话：triage→history（真实 LLM 问诊）→exam → 无遮罩直接选器材/点热点
 *  B. Desktop resume：直连查体阶段活跃会话（EXAM_SESSION_ID）→ 无遮罩直接操作
 *  C. 390px resume：抽屉流程回归（底部导航切器材抽屉 → 手卫生 → 听诊器 → 胸部热点）
 *
 * 390px 口径：移动端遮罩是抽屉模式设计组件（z-65 低于抽屉 z-70/导航 z-80），
 * 不拦截关键操作，断言以底部导航可见 + 功能操作成功为准。
 *
 * 环境要求与凭据口径同 verify-browser-interactive.mjs（PW_CORE_PATH/BROWSER_CRED_FILE）。
 * 用法：
 *  BROWSER_CRED_FILE=/path/to/cred EXAM_SESSION_ID=<exam阶段会话ID> node scripts/verify-browser-backdrop.mjs
 * 输出仅 PASS/FAIL/状态，零患者正文、零凭据。
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const BASE = process.env.BROWSER_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const STORAGE_KEY = 'luojia-peds-auth';
const EXAM_SESSION = process.env.EXAM_SESSION_ID;
const CRED_FILE = process.env.BROWSER_CRED_FILE;

if (!CRED_FILE) { console.error('FATAL 缺少 BROWSER_CRED_FILE'); process.exit(2); }
if (!EXAM_SESSION) { console.error('FATAL 缺少 EXAM_SESSION_ID（查体阶段活跃会话，用于 resume 场景）'); process.exit(2); }

let chromium;
try {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(process.env.PW_CORE_PATH ?? 'playwright-core'));
} catch (e) {
  console.error('FATAL playwright-core 不可用：' + (e instanceof Error ? e.message.split('\n')[0] : e));
  console.error('环境准备见 scripts/verify-browser-interactive.mjs 文件头说明。');
  process.exit(2);
}

function loadCred(file) {
  const map = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (m) map.set(m[1].toLowerCase(), m[2]);
  }
  const email = map.get('email'), password = map.get('password');
  if (!email || !password) throw new Error(`凭据文件 ${file} 缺少 email/password`);
  return { email, password };
}

async function fetchSession(cred) {
  const url = process.env.CODER_SUPABASE_URL, key = process.env.CODER_SUPABASE_ANON_KEY, tid = process.env.CODER_SUPABASE_TENANT_ID;
  if (!url || !key || !tid) throw new Error('缺少 CODER_SUPABASE_* 平台环境变量');
  const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'X-Instance-ID': tid, 'content-type': 'application/json' },
    body: JSON.stringify(cred),
  });
  if (!resp.ok) throw new Error(`登录失败 status=${resp.status}`);
  return resp.json();
}

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

async function openWithSession(page, session, path) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(([k, a, u]) => { localStorage.setItem(k, a); localStorage.setItem(k + '-user', u); }, [STORAGE_KEY, JSON.stringify(session), JSON.stringify({ user: session.user })]);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

async function examInteract(page, label, mobile) {
  // 390px：恢复会话初始在患儿视图（mobileView=patient），先经底部导航切器材抽屉
  if (mobile) {
    await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 });
  }
  await page.waitForSelector('.exam-tool-selector button.tool', { timeout: 25000 });
  // 桌面端修复核心断言：遮罩不可见、无需点击遮罩
  // 390px 遮罩为抽屉设计组件（低 z-index 不拦截操作），以底部导航可见 + 功能断言覆盖
  if (!mobile) {
    const backdropVisible = await page.locator('button.mobile-drawer-backdrop').isVisible().catch(() => false);
    report(`${label} 遮罩不可见（无需点击遮罩）`, !backdropVisible, `visible=${backdropVisible}`);
  } else {
    const navVisible = await page.locator('.mobile-workspace-nav').isVisible().catch(() => false);
    report(`${label} 底部导航可见（移动端抽屉切换入口）`, navVisible, `visible=${navVisible}`);
  }
  const hygiene = page.locator('.exam-tool-selector button.tool', { hasText: '手卫生' }).first();
  await hygiene.click({ timeout: 10000 });
  await page.waitForSelector('.exam-observation[data-status]', { state: 'attached', timeout: 30000 });
  report(`${label} 直接手卫生`, true, `data-status=${await page.getAttribute('.exam-observation', 'data-status')}`);
  const steth = page.locator('.exam-tool-selector button.tool', { hasText: '听诊器' }).first();
  await steth.click({ timeout: 10000 });
  const chest = page.locator('button.hotspot[aria-label="使用当前器材检查胸部"]');
  await chest.waitFor({ state: 'visible', timeout: 15000 });
  await chest.click({ timeout: 10000 });
  await page.waitForSelector('.exam-observation[data-tool="stethoscope"]', { state: 'attached', timeout: 30000 });
  report(`${label} 听诊器+胸部热点`, true, `data-status=${await page.getAttribute('.exam-observation[data-tool="stethoscope"]', 'data-status')}`);
}

const cred = loadCred(CRED_FILE);
const session = await fetchSession(cred);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// A. Desktop 新会话全流程
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const resp = await fetch(`${BASE}/api/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'guided' }) });
    const body = await resp.json();
    const newId = body?.data?.session?.id ?? body?.data?.id;
    if (!newId) throw new Error(`新会话创建失败 status=${resp.status}`);
    await openWithSession(page, session, `/student/training?session=${newId}`);
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });
    await page.click('.training-primary button.btn-primary', { timeout: 15000 });
    await page.waitForSelector('textarea#question', { timeout: 30000 });
    const before = await page.evaluate(() => document.querySelectorAll('.message-list.history-chat > *').length);
    await page.fill('textarea#question', '小朋友，你现在哪里不舒服？');
    await page.click('button.btn-primary:not([disabled])');
    await page.waitForFunction((n) => document.querySelectorAll('.message-list.history-chat > *').length > n, before, { timeout: 90000 });
    await page.click('button.stage-chip[aria-label="可视化体格检查"]', { timeout: 15000 });
    await examInteract(page, 'desktop-新会话', false);
  } catch (e) { report('desktop-新会话', false, e instanceof Error ? e.message.split('\n')[0] : String(e)); }
  await page.close();
}
// B. Desktop resume
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await openWithSession(page, session, `/student/training?session=${EXAM_SESSION}`);
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });
    await examInteract(page, 'desktop-resume', false);
  } catch (e) { report('desktop-resume', false, e instanceof Error ? e.message.split('\n')[0] : String(e)); }
  await page.close();
}
// C. 390px resume 抽屉回归
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openWithSession(page, session, `/student/training?session=${EXAM_SESSION}`);
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });
    await examInteract(page, '390px-抽屉回归', true);
  } catch (e) { report('390px-抽屉回归', false, e instanceof Error ? e.message.split('\n')[0] : String(e)); }
  await page.close();
}
await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`SUMMARY ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
