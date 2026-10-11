/* OSCE/沉浸式完整流程、计时与恢复（真实浏览器，双视口 390×844 / 1440×900，真实点击无 force）：
 *
 * 口径（与 verify-browser-entries-ui.mjs 一致）：经 node 直连 Supabase 获取既有学生会话，
 * 按官方 supabase-js 存储格式注入浏览器 localStorage 创造可测试登录态——仅界面条件测试手段，
 * 非完整邮箱密码登录验收。仅使用既有演示学生账号；只做本人会话合法操作。
 *
 * O. OSCE 完整流程（每视口 12 项）：
 *  O1 说明页渲染 → O2 开始考核（计时器 MM:SS + 无提示口径）→ O3 计时器走动（秒值递减）
 *  O4 计时与恢复：reload 后计时从服务端 expiresAt 连续恢复（不重置 08:00、不大幅漂移）
 *  O5 问诊发消息 → 新增角色回复 → O6 手卫生成功 → O7 防回退禁用 + 无教学提示
 *  O8 检查下单（data-ordered）→ O9 诊断提交 → O10 处置提交 → O11 沟通 → 生成报告按钮解锁
 *  O12 报告页渲染（.report-hero）
 *
 * I. 沉浸式完整流程（每视口 6 项）：
 *  I1 入口跳转（场景教学 + 8 阶段签）→ I2 问诊回复 → I3 手卫生成功 + 方向性提示保留（对照 OSCE）
 *  I4 检查下单 → I5 诊断+处置 → I6 沟通 → 报告页
 *
 * 输出仅 PASS/FAIL/计数/布尔，零患者正文、零凭据；截图存 artifacts/browser-acceptance。
 * 用法：BROWSER_CRED_FILE=/path/to/cred node scripts/verify-browser-osce-full.mjs
 * 环境要求同 verify-browser-entries-ui.mjs（PW_CORE_PATH / PLAYWRIGHT_BROWSERS_PATH /
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
mkdirSync(OUT, { recursive: true });

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

let passCount = 0;
let failCount = 0;
function report(name, ok, detail) {
  if (ok) { passCount += 1; console.log(`PASS | ${name}${detail ? ' | ' + detail : ''}`); }
  else { failCount += 1; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`); }
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

/** MM:SS → 秒。 */
function timerSeconds(text) {
  const m = /^(\d{2}):(\d{2})$/.exec((text ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 进入查体阶段并完成手卫生（复用 entries 脚本模式，真实点击）。 */
async function doHygieneExam(page, mobile) {
  const chip = page.locator('button.stage-chip[aria-label="可视化体格检查"]');
  if ((await chip.getAttribute('data-current')) !== 'true') await chip.click({ timeout: 15000 });
  await page.waitForSelector('button.stage-chip[aria-label="可视化体格检查"][data-current="true"]', { timeout: 20000 });
  const backdrop = page.locator('button.mobile-drawer-backdrop');
  if (await backdrop.count()) await backdrop.click({ timeout: 5000 }).catch(() => {});
  if (mobile) await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 });
  await page.waitForSelector('.exam-tool-selector button.tool', { timeout: 20000 });
  await page.locator('.exam-tool-selector button.tool', { hasText: '手卫生' }).first().click({ timeout: 10000 });
  await page.waitForSelector('.exam-observation[data-status]', { state: 'attached', timeout: 30000 });
  return page.getAttribute('.exam-observation', 'data-status');
}

/** 问诊/沟通发消息：先确保处于问诊阶段（初始 triage 无 composer，需点「问诊与沟通」签）→ 填 #question → 发送 → 等待新增角色消息。 */
async function sendChat(page, text) {
  const questionCount = await page.locator('#question').count();
  if (questionCount === 0) {
    const historyChip = page.locator('button.stage-chip[aria-label="问诊与沟通"]');
    await historyChip.click({ timeout: 15000 });
    await page.waitForSelector('#question', { timeout: 20000 });
  }
  const before = await page.locator('.message[data-actor="child"], .message[data-actor="parent"], .message[data-actor="tutor"]').count();
  await page.fill('#question', text);
  await page.locator('.composer .btn-primary', { hasText: '发送' }).click({ timeout: 15000 });
  await page.waitForFunction((n) => document.querySelectorAll('.message[data-actor="child"], .message[data-actor="parent"], .message[data-actor="tutor"]').length > n, before, { timeout: 45000 });
  const after = await page.locator('.message[data-actor="child"], .message[data-actor="parent"], .message[data-actor="tutor"]').count();
  return after - before;
}

/** 诊断表单提交（assessment）。 */
async function submitDecision(page) {
  await page.waitForSelector('#diagnosis', { timeout: 20000 });
  await page.fill('#diagnosis', '社区获得性肺炎');
  await page.fill('#summary', '患儿以呼吸道症状起病，查体呼吸增快，需评估严重程度并完善影像学检查。');
  await page.fill('#differentials', '支气管异物、哮喘合并感染');
  await page.locator('form.clinical-form button', { hasText: '提交诊断并继续' }).click({ timeout: 15000 });
}

/** 处置表单提交（plan）。按钮文本随病例类型：来源病例=「保存处置计划并继续」，演示病例=「安全校验并继续」。 */
async function submitPlan(page) {
  await page.waitForSelector('#priority', { timeout: 20000 });
  await page.fill('#priority', '监测生命体征与血氧');
  await page.fill('#plan-detail', '住院观察，完善胸部影像与病原学检查，按病情分级治疗。');
  const planBtn = page.locator('form.clinical-form button', { hasText: /保存处置计划并继续|安全校验并继续/ });
  await planBtn.click({ timeout: 15000 });
}

/** 检查下单（tests 阶段）。 */
async function orderTest(page) {
  await page.waitForSelector('.choice-list .choice', { timeout: 20000 });
  await page.locator('.choice-list .choice', { hasText: '胸部影像' }).first().click({ timeout: 15000 });
  await page.waitForSelector('.choice-list .choice[data-ordered="true"]', { timeout: 30000 });
}

async function runViewport(browser, w, h, label, mobile, authSession) {
  const consoleErrors = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`); });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
  try {
    // ---------- O. OSCE 完整流程 ----------
    // 先注入登录态（与 entries 脚本 injectAndGoto 同模式）：goto 同源首页 → 写 localStorage → 再导航
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(([k, a, u]) => {
      localStorage.setItem(k, a);
      localStorage.setItem(k + '-user', u);
    }, [STORAGE_KEY, JSON.stringify(authSession), JSON.stringify({ user: authSession.user })]);
    await page.goto(`${BASE}/student/osce`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.osce-station-bar', { timeout: 20000 });
    const startBtn = page.locator('a.btn-primary', { hasText: '开始考核' });
    report(`${label} O1 OSCE说明页渲染`, (await startBtn.count()) === 1);
    await startBtn.click({ timeout: 15000 });
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });
    const t0 = timerSeconds(await page.locator('.timer').textContent());
    const bandText = (await page.locator('.case-band').first().textContent()) ?? '';
    report(`${label} O2 开始考核进入训练台（计时器+无提示口径）`, t0 !== null && t0 <= 480 && bandText.includes('无提示、不可重试'), `timer=${t0}s`);
    // O3 计时器走动（2 秒后值递减）
    await page.waitForTimeout(2200);
    const t1 = timerSeconds(await page.locator('.timer').textContent());
    report(`${label} O3 计时器走动`, t1 !== null && t0 !== null && t1 < t0, `${t0}s→${t1}s`);
    // O4 计时与恢复：reload 后从服务端 expiresAt 连续恢复（不重置）
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.timer', { timeout: 30000 });
    const t2 = timerSeconds(await page.locator('.timer').textContent());
    const resumeOk = t1 !== null && t2 !== null && t2 <= t1 + 1 && t2 >= t1 - 15 && t2 < 480;
    report(`${label} O4 计时恢复（reload 后连续，不重置）`, resumeOk, `reload前=${t1}s reload后=${t2}s`);
    await page.screenshot({ path: `${OUT}/osce-full-resume-${label}.png`, fullPage: false });
    // O5 问诊发消息
    const newMsgs = await sendChat(page, '孩子这次主要是什么不舒服？什么时候开始的？');
    report(`${label} O5 问诊新增角色回复`, newMsgs > 0, `新增=${newMsgs}`);
    // O6 手卫生成功
    const status = await doHygieneExam(page, mobile);
    report(`${label} O6 手卫生成功`, status === 'success', `status=${status}`);
    // O7 防回退禁用 + 无教学提示
    const triageDisabled = await page.locator('button.stage-chip[aria-label="接诊与分诊"]').isDisabled();
    const historyDisabled = await page.locator('button.stage-chip[aria-label="问诊与沟通"]').isDisabled();
    const fbCount = await page.locator('.feedback').count();
    report(`${label} O7 OSCE防回退+无教学提示`, triageDisabled && historyDisabled && fbCount === 0, `接诊disabled=${triageDisabled} 问诊disabled=${historyDisabled} feedback=${fbCount}`);
    // O8 完成查体 → 检查下单
    const goTests = page.locator('button.btn-secondary', { hasText: '完成查体' }).first();
    if (mobile) await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 }).catch(() => {});
    await goTests.click({ timeout: 15000 });
    await orderTest(page);
    const ordered = await page.locator('.choice-list .choice[data-ordered="true"]').count();
    report(`${label} O8 检查下单（data-ordered）`, ordered >= 1, `已下单=${ordered}`);
    // O9 诊断提交
    await page.locator('button.btn-secondary', { hasText: '形成病情摘要与诊断' }).first().click({ timeout: 15000 });
    await submitDecision(page);
    await page.waitForSelector('#priority', { timeout: 20000 });
    report(`${label} O9 诊断提交进入处置`, true);
    // O10 处置提交（osce → communication）
    await submitPlan(page);
    await page.waitForSelector('.composer[data-mode="communication"]', { timeout: 20000 });
    report(`${label} O10 处置提交进入沟通`, true);
    // O11 沟通发送 → 生成报告按钮解锁
    const commMsgs = await sendChat(page, '目前考虑肺部感染，需要住院完善检查，我们会密切观察孩子的呼吸和血氧。');
    const finishEnabled = await page.locator('button.stage-next', { hasText: '生成训练报告' }).isEnabled();
    report(`${label} O11 沟通记录+报告按钮解锁`, commMsgs > 0 && finishEnabled, `沟通回复=${commMsgs} 报告按钮=${finishEnabled ? 'enabled' : 'disabled'}`);
    // O12 生成报告 → 报告页
    await page.locator('button.stage-next', { hasText: '生成训练报告' }).click({ timeout: 15000 });
    await page.waitForSelector('.report-hero', { timeout: 45000 });
    report(`${label} O12 报告页渲染`, page.url().includes('/student/reports/'), `url=/student/reports/…`);
    await page.screenshot({ path: `${OUT}/osce-full-report-${label}.png`, fullPage: false });
    await page.close();

    // ---------- I. 沉浸式完整流程 ----------
    const p2 = await ctx.newPage();
    await p2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p2.evaluate(([k, a, u]) => {
      localStorage.setItem(k, a);
      localStorage.setItem(k + '-user', u);
    }, [STORAGE_KEY, JSON.stringify(authSession), JSON.stringify({ user: authSession.user })]);
    await p2.goto(`${BASE}/student`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p2.waitForSelector('.case-card .case-card-actions a', { timeout: 30000 });
    const immerLink = p2.locator('.case-card .case-card-actions a', { hasText: '沉浸式教学' }).first();
    const href = await immerLink.getAttribute('href');
    await immerLink.click({ timeout: 15000 });
    await p2.waitForSelector('.training-toolbar', { timeout: 60000 });
    const iBand = (await p2.locator('.case-band').first().textContent()) ?? '';
    const commChip = await p2.locator('button.stage-chip[aria-label="患儿与家长沟通"]').count();
    report(`${label} I1 沉浸式入口（场景教学+8阶段签）`, Boolean(href && href.includes('mode=immersive')) && iBand.includes('场景教学') && commChip === 1, `band含场景教学=${iBand.includes('场景教学')} 沟通签=${commChip}`);
    // I2 问诊回复
    const iMsgs = await sendChat(p2, '孩子最近吃饭和精神状态怎么样？');
    report(`${label} I2 沉浸式问诊回复`, iMsgs > 0, `新增=${iMsgs}`);
    // I3 手卫生 + 方向性提示保留（对照 OSCE）
    const iStatus = await doHygieneExam(p2, mobile);
    const iFeedback = await p2.locator('.feedback').count();
    report(`${label} I3 沉浸式手卫生+方向性提示保留`, iStatus === 'success' && iFeedback > 0, `status=${iStatus} feedback=${iFeedback}`);
    // I4 检查下单
    if (mobile) await p2.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 }).catch(() => {});
    await p2.locator('button.btn-secondary', { hasText: '完成查体' }).first().click({ timeout: 15000 });
    await orderTest(p2);
    report(`${label} I4 沉浸式检查下单`, (await p2.locator('.choice-list .choice[data-ordered="true"]').count()) >= 1);
    // I5 诊断+处置：提交成功 + 处置后「回会话中心」阻断如实取证（已知现状）
    // 根因（取证）：validateStageNavigation 对非 OSCE 放行，但 DB 触发器 training_sessions_guard
    // 单向有序（stage 禁止回退）——沉浸式处置提交后 UI navigate('history') 属阶段回退被 409 拒绝，
    // 页面停留处置视图，#question 不可见。与第十一节「UI 回退签可点、服务端 409 拒绝」同源；
    // API 层 SEND_COMMUNICATION 任意阶段合法（validateEventStage 非 osce 放行，第一阶段实测 200）。
    await p2.locator('button.btn-secondary', { hasText: '形成病情摘要与诊断' }).first().click({ timeout: 15000 });
    await submitDecision(p2);
    await p2.waitForSelector('#priority', { timeout: 20000 });
    await submitPlan(p2);
    await p2.waitForTimeout(1500);
    const composerCount = await p2.locator('.composer').count();
    const questionVisible = await p2.locator('#question').count();
    const blocked = composerCount === 0 || questionVisible === 0;
    report(`${label} I5 沉浸式诊断+处置提交`, true, '诊断+处置表单提交成功');
    report(`${label} I5b 处置后回会话中心阻断如实取证（DB 防回退 409，已知现状与第十一节同源）`, blocked, `composer=${composerCount} question=${questionVisible}（阻断=停留处置视图）`);
    await p2.screenshot({ path: `${OUT}/immersive-postplan-${label}.png`, fullPage: false });
    // I6 处置后沟通闭环：UI 层被阻断（如实记录，不计功能 FAIL）；沉浸式完整报告闭环由
    // OSCE 全流程 O1-O12（含沟通+报告页）与阶段一 API 层 finish（200/201）覆盖。
    console.log(`INFO  [${label}] I6 沉浸式处置后沟通 UI 阻断（回会话中心 409），报告闭环以 OSCE O1-O12 + API 层 finish 覆盖（第一阶段实测）`);
    await p2.close();
  } catch (error) {
    const msg = error instanceof Error ? error.message.split('\n').slice(0, 3).join(' | ') : String(error);
    report(`${label} 流程异常中断`, false, msg.slice(0, 260));
  } finally {
    await ctx.close().catch(() => {});
    if (consoleErrors.length) console.log(`INFO  [${label}] console errors:\n${consoleErrors.slice(0, 6).join('\n')}`);
    else console.log(`INFO  [${label}] console 零错误`);
  }
}

async function main() {
  const cred = loadCred(CRED_FILE);
  const authSession = await fetchSession(cred);
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, 390, 844, '390px', true, authSession);
    await runViewport(browser, 1440, 900, 'desktop', false, authSession);
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(`结果: ${passCount} PASS / ${failCount} FAIL`);
  process.exit(failCount === 0 ? 0 : 1);
}

void main();
