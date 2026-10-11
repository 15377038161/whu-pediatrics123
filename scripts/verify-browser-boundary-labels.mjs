/* 训练展示边界核查（学生端真实渲染实测，2026-10-17 收紧轮第八阶段；真实浏览器只读浏览）：
 *
 * 核查目标：学生端训练台是否清楚标出来源、缺媒体边界，避免把生成内容/AI 回复误认为原始影像：
 *  S1 来源标注可见：来源病例（teacher-川崎病）训练台渲染 case-source-banner
 *     「学习案例：川崎病」+「问诊、查体与检查按原病例资料展开…」（原始来源明示）；
 *  S2 媒体面板空态：学生媒体访问默认关闭（PEDIATRICS_MEDIA_STUDENT_ACCESS 未设，资源 route.ts:22 判定），
 *     资源面板计数 0 项，展开后空态文案「该病种暂无独立资料文件…」（缺媒体边界明示）；
 *  S3 无原始影像 URL：整页 DOM 不含知识库原图外链域名（学生侧不返回原始 URL 实证）；
 *  S4 AI 模拟与病例资料区分：对话消息 actor 标注（child/parent/tutor vs 学生本人）渲染可见；
 *  S5 OSCE 无资料面板：OSCE 会话不渲染资源面板（防作弊口径，静态已证 training-workspace.tsx:388）。
 *
 * 口径：BROWSER_CRED_FILE 注入既有演示学生（界面条件测试手段，与第七节口径一致）；
 * 输出仅 PASS/FAIL/计数/布尔，零患者正文零凭据；截图仅本地。
 * 运行：BROWSER_CRED_FILE=... node scripts/verify-browser-boundary-labels.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.BROWSER_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const OUT = process.env.BROWSER_SCREENSHOT_DIR ?? 'artifacts/browser-acceptance';
const CRED_FILE = process.env.BROWSER_CRED_FILE;
const STORAGE_KEY = 'luojia-peds-auth';
if (!CRED_FILE) { console.error('FATAL 缺少 BROWSER_CRED_FILE'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE_PATH ?? 'playwright-core');

function loadCred(file) {
  const map = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (m) map.set(m[1].toLowerCase(), m[2]);
  }
  const email = map.get('email'), password = map.get('password');
  if (!email || !password) throw new Error('凭据文件缺少 email/password');
  return { email, password };
}
async function fetchSession(cred) {
  const url = process.env.CODER_SUPABASE_URL, key = process.env.CODER_SUPABASE_ANON_KEY, tid = process.env.CODER_SUPABASE_TENANT_ID;
  const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'X-Instance-ID': tid, 'content-type': 'application/json' },
    body: JSON.stringify(cred),
  });
  if (!resp.ok) throw new Error(`登录失败 status=${resp.status}`);
  return await resp.json();
}

let passCount = 0, failCount = 0;
function report(name, ok, detail) {
  if (ok) { passCount += 1; console.log(`PASS | ${name}${detail ? ' | ' + detail : ''}`); }
  else { failCount += 1; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`); }
}

async function main() {
  const authSession = await fetchSession(loadCred(CRED_FILE));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // Node 侧建会话（页面上下文 evaluate(fetch) 时机不稳定，改与其他脚本一致的 Node fetch 模式）
  const token = authSession.access_token;
  async function createSession(mode) {
    const resp = await fetch(`${BASE}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ mode, caseId: 'teacher-川崎病' }) });
    const body = await resp.json().catch(() => ({}));
    return body?.data?.id ?? '';
  }
  try {
    // 来源病例 guided 会话（teacher-川崎病）：直接建会话后进训练台
    const created = await createSession('guided');
    if (!created) { report('建会话失败', false); process.exit(1); }
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(([k, a, u]) => {
      localStorage.setItem(k, a);
      localStorage.setItem(k + '-user', u);
    }, [STORAGE_KEY, JSON.stringify(authSession), JSON.stringify({ user: authSession.user })]);
    await page.goto(`${BASE}/student/training?session=${created}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });

    // S1 来源标注可见
    await page.waitForSelector('.case-source-banner', { timeout: 20000 });
    const bannerText = (await page.locator('.case-source-banner').textContent()) ?? '';
    report('S1 来源标注（学习案例：川崎病 + 原病例资料口径）', bannerText.includes('学习案例') && bannerText.includes('川崎病') && bannerText.includes('原病例资料'), `banner=${bannerText.includes('学习案例：川崎病')}`);

    // S4 AI 模拟与病例资料区分：问一轮，确认角色消息 actor 可辨（消息区有 child/parent/tutor 标注元素）
    const historyChip = page.locator('button.stage-chip[aria-label="问诊与沟通"]');
    if ((await page.locator('#question').count()) === 0) { await historyChip.click({ timeout: 15000 }); await page.waitForSelector('#question', { timeout: 20000 }); }
    const before = await page.locator('.message').count();
    await page.fill('#question', '孩子发烧几天了？');
    await page.locator('.composer .btn-primary', { hasText: '发送' }).click({ timeout: 15000 });
    await page.waitForFunction((n) => document.querySelectorAll('.message').length > n, before, { timeout: 45000 });
    const actorMarked = await page.evaluate(() => {
      // 消息元素带 data-actor 属性（child/parent/tutor/student 区分 AI 模拟与本人输入）
      const msgs = [...document.querySelectorAll('.message')];
      return msgs.length > 0 && msgs.every((m) => m.hasAttribute('data-actor'));
    });
    report('S4 消息 actor 标注齐全（AI 模拟与本人输入可区分）', actorMarked);

    // S2 媒体面板空态（学生媒体默认关闭）：先等计数脱离「加载中」再取文本（避免竞态误断）
    await page.waitForSelector('.case-resource-panel .resource-panel-toggle', { timeout: 20000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('.case-resource-panel .resource-panel-toggle');
      return !!el && !el.textContent?.includes('加载中');
    }, { timeout: 20000 });
    const toggleText = (await page.locator('.case-resource-panel .resource-panel-toggle').textContent()) ?? '';
    const zeroCount = toggleText.includes('0 项');
    await page.locator('.case-resource-panel .resource-panel-toggle').click({ timeout: 10000 });
    await page.waitForSelector('.resource-panel-body p', { timeout: 10000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('.resource-panel-body p');
      return !!el && !el.textContent?.includes('正在读取病例资料');
    }, { timeout: 20000 });
    const emptyText = (await page.locator('.resource-panel-body p').first().textContent()) ?? '';
    report('S2 资源面板 0 项 + 缺媒体空态文案', zeroCount && emptyText.includes('暂无独立资料文件'), `计数0项=${zeroCount} 空态文案=${emptyText.includes('暂无独立资料文件')}`);

    // S3 无原始影像 URL（整页 DOM 不含知识库原图外链域名）
    const rawUrlLeak = await page.evaluate(() => document.documentElement.outerHTML.includes('p.cldisk.com'));
    report('S3 学生页面无知识库原始影像 URL', !rawUrlLeak, `泄露=${rawUrlLeak}`);
    await page.screenshot({ path: `${OUT}/boundary-labels-desktop.png`, fullPage: false });

    // S5 OSCE 会话不渲染资源面板（防作弊）：Node 侧建会话（页面上下文 fetch 时机不稳定）
    const osceCreated = await createSession('osce');
    if (!osceCreated) { report('S5 建会话失败', false); process.exit(1); }
    await page.goto(`${BASE}/student/training?session=${osceCreated}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });
    await page.waitForTimeout(1500);
    const oscePanelCount = await page.locator('.case-resource-panel').count();
    report('S5 OSCE 会话不渲染资源面板（防作弊）', oscePanelCount === 0, `面板=${oscePanelCount}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message.split('\n').slice(0, 3).join(' | ') : String(error);
    report('流程异常中断', false, msg.slice(0, 260));
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  console.log(`结果: ${passCount} PASS / ${failCount} FAIL`);
  process.exit(failCount === 0 ? 0 : 1);
}

void main();
