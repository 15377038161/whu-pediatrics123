/* OSCE/沉浸式入口与禁用态、3D 解剖实验室、题库操作 UI 闭环验收（真实浏览器，双视口 390×844 / 1440×900）：
 *
 * 口径（与 verify-browser-interactive.mjs 一致）：经 node 直连 Supabase 获取既有学生会话，
 * 按官方 supabase-js 存储格式注入浏览器 localStorage 创造可测试登录态——仅界面条件测试手段，
 * 非完整邮箱密码登录验收。仅使用既有演示学生账号；只做本人会话合法操作。
 *
 * C. 学生首页与入口：
 *  C1 入口卡渲染（OSCE 考站 / 3D 解剖实验室 / 专项训练）
 *  C2 病例库筛选「资料不足」：OSCE 入口禁用态（span.text-link.disabled + aria-disabled，
 *     卡内无 mode=osce 链接）+ 资料不足说明可见 + 沉浸式入口仍可用
 *  C3 沉浸式入口跳转：点病例卡「沉浸式教学」→ 训练台加载 + case-band「场景教学」+ 8 阶段签
 *
 * D. OSCE 模式（入口卡 → 说明页 → 开始考核）：
 *  D1 OSCE 说明页渲染（考站信息栏 + 开始考核按钮）
 *  D2 训练台：计时器可见（MM:SS）+ case-band「无提示、不可重试」+ 8 阶段签（含沟通）
 *  D3 防回退禁用态：前进至查体后，「接诊与分诊」「问诊与沟通」阶段签 disabled
 *  D4 无教学提示：手卫生后 .feedback 不渲染（osce feedbackFor=null）+ 查体结果正常获得
 *
 * E. 沉浸式反馈对比：同操作手卫生后 .feedback 渲染（immersive 保留方向性提示）
 *
 * F. 儿童骨骼三维模型：实际GLB加载、区域筛选、部件联动、隔离、分离与重置
 *
 * G. 题库操作闭环：取题 → 选择 → 提交 → 判分与解析 → 下一题 → 错题复盘 → 继续答题；
 *    题池取完时空态明确展示（动态分支，两种路径均闭环）
 *
 * 输出仅 PASS/FAIL/计数/布尔，零患者正文、零凭据；截图存 artifacts/browser-acceptance。
 * 用法：BROWSER_CRED_FILE=/path/to/cred node scripts/verify-browser-entries-ui.mjs
 * 环境要求同 verify-browser-interactive.mjs（PW_CORE_PATH / PLAYWRIGHT_BROWSERS_PATH /
 * LD_LIBRARY_PATH / FONTCONFIG_FILE，见验收记录第七节环境突破）。
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.BROWSER_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const OUT = process.env.BROWSER_SCREENSHOT_DIR ?? 'artifacts/browser-acceptance';
const CRED_FILE = process.env.BROWSER_CRED_FILE;
const STORAGE_KEY = 'luojia-peds-auth';

if (!CRED_FILE) {
  console.error('FATAL 缺少 BROWSER_CRED_FILE（凭据文件路径，键值对文本：email/password）。不硬编码凭据。');
  process.exit(2);
}

let chromium;
try {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(process.env.PW_CORE_PATH ?? 'playwright-core'));
} catch (e) {
  console.error('FATAL playwright-core 不可用：' + (e instanceof Error ? e.message.split('\n')[0] : e));
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
  const session = await resp.json();
  if (!session.access_token) throw new Error('登录响应缺少 access_token');
  return session;
}

async function createTrainingSession(accessToken, mode, caseId) {
  const resp = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mode, ...(caseId ? { caseId } : {}) }),
  });
  const body = await resp.json().catch(() => null);
  const id = body?.data?.session?.id ?? body?.data?.id;
  if (!id) throw new Error(`会话创建失败 mode=${mode} status=${resp.status}`);
  return id;
}

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

async function injectAndGoto(ctx, authSession, path) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(([k, a, u]) => {
    localStorage.setItem(k, a);
    localStorage.setItem(k + '-user', u);
  }, [STORAGE_KEY, JSON.stringify(authSession), JSON.stringify({ user: authSession.user })]);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return page;
}

/** 训练台查体：点击查体阶段签 → 手卫生 → 返回 .exam-observation 的 data-status（合法前进）。 */
async function doHygieneExam(page, mobile, chipLabel = '可视化体格检查') {
  const chip = page.locator(`button.stage-chip[aria-label="${chipLabel}"]`);
  if ((await chip.getAttribute('data-current')) !== 'true') await chip.click({ timeout: 15000 });
  await page.waitForSelector(`button.stage-chip[aria-label="${chipLabel}"][data-current="true"]`, { timeout: 20000 });
  const backdrop = page.locator('button.mobile-drawer-backdrop');
  if (await backdrop.count()) await backdrop.click({ timeout: 5000 }).catch(() => {});
  if (mobile) await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 });
  await page.waitForSelector('.exam-tool-selector button.tool', { timeout: 20000 });
  await page.locator('.exam-tool-selector button.tool', { hasText: '手卫生' }).first().click({ timeout: 10000 });
  await page.waitForSelector('.exam-observation[data-status]', { state: 'attached', timeout: 30000 });
  return page.getAttribute('.exam-observation', 'data-status');
}

async function runViewport(browser, w, h, label, mobile, authSession) {
  const consoleErrors = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`); });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
  try {
    // ---------- C. 学生首页与入口 ----------
    await injectAndGoto(ctx, authSession, '/student').then(async (p) => { await page.close(); return p; }).then(async (p) => {
      await p.waitForSelector('.entry-list', { timeout: 30000 });
      const osceEntry = await p.locator('a.entry[href="/student/osce"]').count();
      const anatomyEntry = await p.locator('a.entry[href="/student/anatomy"]').count();
      const practiceEntry = await p.locator('a.entry[href="/student/practice"]').count();
      report(`${label} C1 入口卡渲染`, osceEntry === 1 && anatomyEntry === 1 && practiceEntry === 1, `osce=${osceEntry} anatomy=${anatomyEntry} practice=${practiceEntry}`);
      return p;
    }).then(async (p) => {
      // C2. 筛选「资料不足」→ OSCE 禁用态
      await p.waitForSelector('.case-library-filter select[aria-label="按资料来源筛选"]', { timeout: 30000 });
      await p.selectOption('select[aria-label="按资料来源筛选"]', 'insufficient');
      await p.waitForTimeout(600);
      const disabledOsce = await p.locator('.case-card span.text-link.disabled[aria-disabled="true"]').count();
      const insuffNote = await p.locator('.case-insufficient-note').count();
      // 禁用卡内不得存在 mode=osce 链接（JS 断言：含 disabled span 的卡内无 osce 链接）
      const leakOsce = await p.evaluate(() => {
        const cards = [...document.querySelectorAll('.case-card')].filter((card) => card.querySelector('span.text-link.disabled'));
        return cards.some((card) => card.querySelector('a[href*="mode=osce"]') !== null);
      });
      const immersiveOnInsuff = await p.evaluate(() => {
        const cards = [...document.querySelectorAll('.case-card')].filter((card) => card.querySelector('span.text-link.disabled'));
        return cards.length > 0 && cards.every((card) => card.querySelector('a[href*="mode=immersive"]') !== null);
      });
      report(`${label} C2 资料不足OSCE禁用态`, disabledOsce > 0 && insuffNote > 0 && !leakOsce, `禁用卡=${disabledOsce} 说明=${insuffNote} 泄漏osce链接=${leakOsce}`);
      report(`${label} C2b 资料不足卡沉浸式仍可用`, immersiveOnInsuff);
      await p.screenshot({ path: `${OUT}/entries-insufficient-${label}.png`, fullPage: false });
      // 切回全部来源
      await p.selectOption('select[aria-label="按资料来源筛选"]', 'all');
      await p.waitForTimeout(600);
      return p;
    }).then(async (p) => {
      // C3. 沉浸式入口跳转：点第一张卡「沉浸式教学」
      await p.waitForSelector('.case-card .case-card-actions a', { timeout: 20000 });
      const immerLink = p.locator('.case-card .case-card-actions a', { hasText: '沉浸式教学' }).first();
      const href = await immerLink.getAttribute('href');
      const hrefOk = Boolean(href && href.includes('mode=immersive&case='));
      await immerLink.click({ timeout: 15000 });
      await p.waitForSelector('.training-toolbar', { timeout: 60000 });
      // 口径注意：训练台创建会话后 URL 会替换为 ?session=<id>，故此处只断言已进入训练台；
      // 「沉浸式」入口语义由点击前 href 含 mode=immersive&case=（hrefOk）+ C3b 模式渲染断言共同证实。
      const bandText = await p.locator('.case-band').first().textContent();
      const commChip = await p.locator('button.stage-chip[aria-label="患儿与家长沟通"]').count();
      report(`${label} C3 沉浸式入口跳转`, hrefOk && p.url().includes('/student/training'), `href含immersive=${hrefOk}`);
      report(`${label} C3b 沉浸式标识与全阶段`, (bandText ?? '').includes('场景教学') && commChip === 1, `band含场景教学=${(bandText ?? '').includes('场景教学')} 沟通签=${commChip}`);
      await p.screenshot({ path: `${OUT}/entries-immersive-${label}.png`, fullPage: false });
      // E. 沉浸式反馈对比：手卫生 → .feedback 渲染（immersive 保留方向性提示）
      const status = await doHygieneExam(p, mobile);
      const fbCount = await p.locator('.feedback').count();
      report(`${label} E 沉浸式保留方向性提示`, status === 'success' && fbCount > 0, `status=${status} feedback=${fbCount}`);
      return p;
    }).then(async (p) => {
      // ---------- D. OSCE：入口卡 → 说明页 → 开始考核 ----------
      await p.goto(`${BASE}/student/osce`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForSelector('.osce-station-bar', { timeout: 20000 });
      const startBtn = p.locator('a.btn-primary', { hasText: '开始考核' });
      report(`${label} D1 OSCE说明页渲染`, (await startBtn.count()) === 1);
      await startBtn.click({ timeout: 15000 });
      await p.waitForSelector('.training-toolbar', { timeout: 60000 });
      const timerText = (await p.locator('.timer').textContent() ?? '').trim();
      const bandText = await p.locator('.case-band').first().textContent();
      const commChip = await p.locator('button.stage-chip[aria-label="患儿与家长沟通"]').count();
      report(`${label} D2 训练台计时器与口径`, /^\d{2}:\d{2}$/.test(timerText) && (bandText ?? '').includes('无提示、不可重试') && commChip === 1, `timer=${timerText}`);
      // D3+D4. 前进至查体 → 防回退禁用态 + 手卫生无反馈
      const status = await doHygieneExam(p, mobile);
      const triageDisabled = await p.locator('button.stage-chip[aria-label="接诊与分诊"]').isDisabled();
      const historyDisabled = await p.locator('button.stage-chip[aria-label="问诊与沟通"]').isDisabled();
      report(`${label} D3 OSCE防回退禁用态`, triageDisabled && historyDisabled, `接诊=${triageDisabled} 问诊=${historyDisabled}`);
      const fbCount = await p.locator('.feedback').count();
      report(`${label} D4 OSCE无教学提示`, status === 'success' && fbCount === 0, `status=${status} feedback=${fbCount}`);
      await p.screenshot({ path: `${OUT}/entries-osce-${label}.png`, fullPage: false });
      return p;
    }).then(async (p) => {
      // ---------- F. 儿童骨骼三维模型（旧二维色块已移除） ----------
      await p.goto(`${BASE}/student/anatomy`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.getByText('儿童模型已加载', { exact: false }).waitFor({ timeout: 60000 });
      const partCount = await p.locator('.anatomy-part-list button').count();
      report(`${label} F1 儿童模型加载`, partCount > 100 && await p.locator('canvas').count() === 1, `网格部件=${partCount}`);
      await p.locator('#anatomy-region').selectOption('skull');
      await p.locator('.anatomy-part-list button').first().click();
      const infoTitle = (await p.locator('.anatomy-info h2').textContent() ?? '').trim();
      report(`${label} F2 部件信息联动`, infoTitle.includes('颅骨'));
      await p.getByRole('button', { name: '只看选中部件', exact: true }).click();
      report(`${label} F3 单部件隔离`, await p.getByRole('button', { name: '恢复区域显示', exact: true }).count() === 1);
      await p.locator('.explode-control input').fill('0.8');
      report(`${label} F4 分离滑杆`, await p.locator('.explode-control output').textContent() === '80%');
      await p.getByRole('button', { name: '重置', exact: true }).click();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      report(`${label} F5 重置及无溢出`, await p.locator('.explode-control output').textContent() === '0%' && overflow <= 1);
      await p.screenshot({ path: `${OUT}/entries-anatomy-${label}.png`, fullPage: false });
      return p;
    }).then(async (p) => {
      // ---------- G. 题库操作闭环 ----------
      await p.goto(`${BASE}/student/quiz`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForSelector('.quiz-panel, .empty-state', { timeout: 30000 });
      // 状态机：等待初始取题收敛到「作答面板 / 题池取完空态 / 错误态」三态之一；
      // 错误态走页面真实「重试」按钮一次（上轮 desktop 曾出现取题未收敛超时，未定根因，
      // 不允许静默失败——重试后仍未收敛则显式 FAIL 并输出当前态态文本长度供定位）。
      let quizState = '';
      let retried = false;
      for (let i = 0; i < 15 && !quizState; i++) {
        await p.waitForTimeout(1000);
        if (await p.locator('.quiz-panel .quiz-stem').count()) quizState = 'answering';
        else if (await p.locator('.empty-state', { hasText: '题池已取完' }).count()) quizState = 'exhausted';
        else {
          const retryBtn = p.locator('.empty-state button', { hasText: '重试' });
          if ((await retryBtn.count()) && !retried) {
            retried = true;
            await retryBtn.click({ timeout: 5000 }).catch(() => {});
          }
        }
      }
      if (!quizState) {
        const stateText = (await p.locator('.empty-state').first().textContent() ?? '').trim();
        report(`${label} G0 取题收敛`, false, `15s 未收敛 retried=${retried} 状态文本长度=${stateText.length}`);
      }
      if (quizState === 'exhausted') {
        // 分支一：题池取完 → 空态明确展示。
        // 口径（用户收紧要求）：空态展示与作答/判分完整闭环是不同验收项，分列计数——
        // 本分支只证明「题池取完的空态 UI 明确展示」，不证明作答/判分闭环（后者见 G1 作答分支，
        // 需账号有可答题）。不改既有账号作答记录、不重置题池制造可答题。
        report(`${label} G1-空态 题池取完空态展示（非作答闭环）`, true, '空态文案可见；作答/判分闭环未在本分支覆盖');
      } else if (quizState === 'answering') {
        // 分支二：正常作答闭环
        await p.locator('.quiz-panel .choice-list .choice').first().click({ timeout: 10000 });
        const selectedMark = await p.locator('.quiz-panel .choice-list .choice').first().getAttribute('data-selected');
        await p.locator('.quiz-panel button.btn-primary', { hasText: '提交答案' }).click({ timeout: 10000 });
        await p.waitForSelector('.quiz-verdict[data-correct]', { timeout: 30000 });
        const verdict = await p.locator('.quiz-verdict').getAttribute('data-correct');
        const correctShown = (await p.locator('.quiz-panel .feedback strong').textContent() ?? '').includes('正确答案');
        const already = (await p.locator('.quiz-verdict').textContent() ?? '').includes('此前已作答');
        report(`${label} G1 取题作答判分`, selectedMark === 'true' && (verdict === 'true' || verdict === 'false') && correctShown, `verdict=${verdict} 首答锁定=${!already}`);
        const nextBtn = p.locator('.quiz-panel button.btn-primary');
        await nextBtn.click({ timeout: 10000 });
        await p.waitForTimeout(800);
        // 下一题或再来一批后应回到可作答状态（新题干或同题干重取均可，断言面板存在且可重新选择）
        const answering = await p.locator('.quiz-panel .choice-list .choice').count();
        report(`${label} G2 下一题/再来一批`, answering > 0, `选项数=${answering}`);
      }
      // 错题复盘 → 继续答题（复盘渲染两分支同口径；继续答题后的返回态按分支分列：作答分支返回作答面板，空态分支返回空态）
      const answeringBranch = quizState === 'answering';
      await p.locator('.quiz-toolbar button', { hasText: '错题复盘' }).click({ timeout: 10000 });
      await p.waitForSelector('.quiz-review-list, .quiz-panel .empty-state', { timeout: 30000 });
      const reviewShown = await p.locator('.quiz-review-list').count() + await p.locator('.quiz-panel .empty-state', { hasText: '暂无作答记录' }).count();
      report(`${label} ${answeringBranch ? 'G3 错题复盘渲染' : 'G3-空态 错题复盘渲染'}`, reviewShown > 0);
      await p.locator('.quiz-panel button.btn-primary', { hasText: '继续答题' }).click({ timeout: 10000 });
      // 竞态修复（断言时机缺陷）：复盘面板标题本身是 .quiz-stem（「错题复盘（共…）」），点击
      // 「继续答题」后 fetch 在途时复盘面板仍渲染，waitForSelector 会立即命中残留复盘标题——
      // 必须先等「复盘标题从 DOM 消失」（真正离开复盘态），再判定终态（作答题干或题池取完空态）。
      await p.waitForFunction(() => ![...document.querySelectorAll('.quiz-panel .quiz-stem')].some((s) => (s.textContent ?? '').includes('错题复盘')), null, { timeout: 30000 });
      await p.waitForTimeout(300);
      const backStem = await p.locator('.quiz-panel .quiz-stem').count();
      const backEmpty = await p.locator('.empty-state', { hasText: '题池已取完' }).count();
      report(`${label} ${answeringBranch ? 'G4 继续答题返回作答态' : 'G4-空态 继续答题（题池取完返回空态）'}`, answeringBranch ? backStem > 0 : backEmpty > 0, `作答面板=${backStem} 空态=${backEmpty}`);
      await p.screenshot({ path: `${OUT}/entries-quiz-${label}.png`, fullPage: false });
      return p;
    });
    await page.close();
  } catch (e) {
    report(`${label} 视口流程`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
  } finally {
    report(`${label} console 无错误`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' ; ').slice(0, 150));
    await ctx.close();
  }
}

const cred = loadCred(CRED_FILE);
const authSession = await fetchSession(cred);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await runViewport(browser, 390, 844, '390px', true, authSession);
await runViewport(browser, 1440, 900, 'desktop', false, authSession);
await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`SUMMARY ${pass}/${results.length} PASS`);
process.exit(pass === results.length ? 0 : 1);
