/* 沉浸式处置后「返回会话中心」409 阻断修复——浏览器双视口真实点击复测（2026-10-17 收紧轮第六阶段）：
 *
 * 修复内容：SessionState.viewStage（回看展示阶段）。非 OSCE 的回看导航只记 viewStage 不改业务阶段 stage，
 * DB 防回退触发器语义保持；处置提交后 UI navigate('history')（training-workspace.tsx plan 分支）由此恢复。
 *
 * 口径（与 verify-browser-osce-full.mjs 一致）：经 node 直连 Supabase 获取既有学生会话，
 * 按官方 supabase-js 存储格式注入浏览器 localStorage 创造可测试登录态——仅界面条件测试手段，
 * 非完整邮箱密码登录验收。仅使用既有演示学生账号；只做本人会话合法操作；每视口 1 个沉浸式新会话（正常业务写入）。
 *
 * 每视口验证项（真实点击无 force，409 不计通过）：
 *  V1 沉浸式入口（场景教学 + 8 阶段签含沟通）
 *  V2 问诊新增角色回复
 *  V3 手卫生成功 + 方向性提示保留
 *  V4 检查下单（data-ordered）→ 诊断提交 → 处置提交
 *  V5 处置后自动返回会话中心：#question composer 可见（修复前 DB 409 阻断停留处置视图，#question=0）
 *  V6 回看态问诊发送 → 新增角色回复（修复前无法到达问诊输入框）
 *  V7 生成训练报告按钮解锁（沟通已记录后 enabled）
 *  V8 回看查体阶段：查体签 data-current + 器材栏渲染（spatialExam）+ 处置签 data-done（已完成阶段持久化）
 *  V9 reload 后仍处查体回看视图（viewStage 服务端持久化，恢复不丢失）
 *  V10 返回学生首页出现「继续训练」入口（active 会话恢复链路）
 *  V11 继续训练重新进入 → 查体回看视图恢复（.exam-tool-selector 渲染）
 *  V12 点「问诊与沟通」返回会话中心（#question 可见）→ 生成训练报告 → 报告页渲染
 *
 * 输出仅 PASS/FAIL/计数/布尔，零患者正文、零凭据；截图存 artifacts/browser-acceptance。
 * 用法：BROWSER_CRED_FILE=/path/to/cred node scripts/verify-browser-viewstage.mjs
 * 环境要求同 verify-browser-entries-ui.mjs（PW_CORE_PATH / PLAYWRIGHT_BROWSERS_PATH /
 * LD_LIBRARY_PATH / FONTCONFIG_FILE，见验收记录第七节环境突破；/tmp 被清理后先 rebuild-browser-env.sh）。
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

async function injectAuth(page, authSession) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(([k, a, u]) => {
    localStorage.setItem(k, a);
    localStorage.setItem(k + '-user', u);
  }, [STORAGE_KEY, JSON.stringify(authSession), JSON.stringify({ user: authSession.user })]);
}

/** 导航至学生首页（ERR_ABORTED 时重试一次——页面自身跳转可中断当前导航，desktop 实测偶发）。 */
async function gotoStudent(page) {
  try {
    await page.goto(`${BASE}/student`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('ERR_ABORTED')) throw e;
    await page.goto(`${BASE}/student`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
}

/** 进入查体阶段并完成手卫生（真实点击）。 */
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

/** 问诊/沟通发消息（已处问诊视图时直发）。 */
async function sendChat(page, text) {
  const questionCount = await page.locator('#question').count();
  if (questionCount === 0) {
    await page.locator('button.stage-chip[aria-label="问诊与沟通"]').click({ timeout: 15000 });
    await page.waitForSelector('#question', { timeout: 20000 });
  }
  const before = await page.locator('.message[data-actor="child"], .message[data-actor="parent"], .message[data-actor="tutor"]').count();
  await page.fill('#question', text);
  await page.locator('.composer .btn-primary', { hasText: '发送' }).click({ timeout: 15000 });
  await page.waitForFunction((n) => document.querySelectorAll('.message[data-actor="child"], .message[data-actor="parent"], .message[data-actor="tutor"]').length > n, before, { timeout: 45000 });
  const after = await page.locator('.message[data-actor="child"], .message[data-actor="parent"], .message[data-actor="tutor"]').count();
  return after - before;
}

async function runViewport(browser, w, h, label, mobile, authSession) {
  const consoleErrors = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`); });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
  try {
    // ---------- 沉浸式进入并推进到处置 ----------
    await injectAuth(page, authSession);
    await gotoStudent(page);
    await page.waitForSelector('.case-card .case-card-actions a', { timeout: 30000 });
    const immerLink = page.locator('.case-card .case-card-actions a', { hasText: '沉浸式教学' }).first();
    await immerLink.click({ timeout: 15000 });
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });
    const bandText = (await page.locator('.case-band').first().textContent()) ?? '';
    const commChip = await page.locator('button.stage-chip[aria-label="患儿与家长沟通"]').count();
    report(`${label} V1 沉浸式入口（场景教学+8阶段签）`, bandText.includes('场景教学') && commChip === 1, `band含场景教学=${bandText.includes('场景教学')} 沟通签=${commChip}`);

    const msgs1 = await sendChat(page, '孩子这次主要是什么不舒服？什么时候开始的？');
    report(`${label} V2 沉浸式问诊回复`, msgs1 > 0, `新增=${msgs1}`);

    const status = await doHygieneExam(page, mobile);
    const fbCount = await page.locator('.feedback').count();
    report(`${label} V3 手卫生成功+方向性提示保留`, status === 'success' && fbCount > 0, `status=${status} feedback=${fbCount}`);

    if (mobile) await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 }).catch(() => {});
    await page.locator('button.btn-secondary', { hasText: '完成查体' }).first().click({ timeout: 15000 });
    await page.waitForSelector('.choice-list .choice', { timeout: 20000 });
    await page.locator('.choice-list .choice', { hasText: '胸部影像' }).first().click({ timeout: 15000 });
    await page.waitForSelector('.choice-list .choice[data-ordered="true"]', { timeout: 30000 });
    await page.locator('button.btn-secondary', { hasText: '形成病情摘要与诊断' }).first().click({ timeout: 15000 });
    await page.waitForSelector('#diagnosis', { timeout: 20000 });
    await page.fill('#diagnosis', '社区获得性肺炎');
    await page.fill('#summary', '患儿以呼吸道症状起病，查体呼吸增快，需评估严重程度并完善影像学检查。');
    await page.fill('#differentials', '支气管异物、哮喘合并感染');
    await page.locator('form.clinical-form button', { hasText: '提交诊断并继续' }).click({ timeout: 15000 });
    await page.waitForSelector('#priority', { timeout: 20000 });
    await page.fill('#priority', '监测生命体征与血氧');
    await page.fill('#plan-detail', '住院观察，完善胸部影像与病原学检查，按病情分级治疗。');
    const planBtn = page.locator('form.clinical-form button', { hasText: /保存处置计划并继续|安全校验并继续/ });
    await planBtn.click({ timeout: 15000 });
    report(`${label} V4 检查下单→诊断→处置提交`, true, '三表单提交成功');

    // ---------- 修复核心：处置后自动返回会话中心 ----------
    // 处置提交后 UI navigate('history')（plan 分支）：修复前 DB 触发器 409 阻断停留处置视图（#question=0）；
    // 修复后仅记 viewStage=history，业务阶段保持 plan，问诊输入框可达。
    await page.waitForSelector('#question', { timeout: 30000 });
    const questionVisible = await page.locator('#question').count();
    report(`${label} V5 处置后自动返回会话中心（#question 可见，修复前 409 阻断）`, questionVisible === 1, `question=${questionVisible}`);

    // 回看态问诊（修复前无法到达问诊输入框）
    const msgs2 = await sendChat(page, '住院期间我们怎么配合观察孩子的病情变化？');
    report(`${label} V6 回看态问诊发送（新增角色回复）`, msgs2 > 0, `新增=${msgs2}`);

    // 沟通已记录 → 生成训练报告按钮解锁
    const finishBtn = page.locator('button.stage-next', { hasText: '生成训练报告' });
    const finishEnabled = (await finishBtn.count()) === 1 && (await finishBtn.isEnabled());
    report(`${label} V7 生成训练报告按钮解锁`, finishEnabled, `enabled=${finishEnabled}`);

    // ---------- 回看查体阶段 + 阶段持久化 ----------
    const examChip = page.locator('button.stage-chip[aria-label="可视化体格检查"]');
    await examChip.click({ timeout: 15000 });
    await page.waitForSelector('button.stage-chip[aria-label="可视化体格检查"][data-current="true"]', { timeout: 20000 });
    const backdrop = page.locator('button.mobile-drawer-backdrop');
    if (await backdrop.count()) await backdrop.click({ timeout: 5000 }).catch(() => {});
    if (mobile) await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 });
    await page.waitForSelector('.exam-tool-selector button.tool', { timeout: 20000 });
    const toolsVisible = (await page.locator('.exam-tool-selector button.tool').count()) > 0;
    const planDone = await page.locator('button.stage-chip[aria-label="治疗及处置计划"]').getAttribute('data-done');
    report(`${label} V8 回看查体阶段（器材栏渲染）+处置签完成态（阶段持久化）`, toolsVisible && planDone === 'true', `器材栏=${toolsVisible} 处置done=${planDone}`);
    await page.screenshot({ path: `${OUT}/viewstage-exam-review-${label}.png`, fullPage: false });

    // ---------- reload 持久化 ----------
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });
    const bd2 = page.locator('button.mobile-drawer-backdrop');
    if (await bd2.count()) await bd2.click({ timeout: 5000 }).catch(() => {});
    if (mobile) await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 }).catch(() => {});
    await page.waitForSelector('.exam-tool-selector button.tool', { timeout: 20000 });
    const toolsAfterReload = (await page.locator('.exam-tool-selector button.tool').count()) > 0;
    report(`${label} V9 reload 后仍处查体回看视图（viewStage 服务端持久化）`, toolsAfterReload, `器材栏=${toolsAfterReload}`);

    // ---------- 返回首页 → 继续训练恢复 ----------
    await gotoStudent(page);
    // 首页按钮初始渲染为「开始接诊」，sessions 异步加载后才变「继续训练」——必须等待文本切换（竞态修复）
    const resumeLink = page.locator('.hero-actions a.btn-primary', { hasText: '继续训练' });
    let resumeCount = 0;
    try {
      await resumeLink.waitFor({ timeout: 30000 });
      resumeCount = await resumeLink.count();
    } catch {
      resumeCount = 0;
    }
    report(`${label} V10 首页出现继续训练入口（active 会话）`, resumeCount === 1, `入口=${resumeCount}`);
    if (resumeCount === 1) {
      await resumeLink.click({ timeout: 15000 });
      await page.waitForSelector('.training-toolbar', { timeout: 60000 });
      const bd3 = page.locator('button.mobile-drawer-backdrop');
      if (await bd3.count()) await bd3.click({ timeout: 5000 }).catch(() => {});
      if (mobile) await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 }).catch(() => {});
      await page.waitForSelector('.exam-tool-selector button.tool', { timeout: 20000 });
      const toolsResume = (await page.locator('.exam-tool-selector button.tool').count()) > 0;
      report(`${label} V11 继续训练恢复至查体回看视图`, toolsResume, `器材栏=${toolsResume}`);
    } else {
      report(`${label} V11 继续训练恢复至查体回看视图`, false, 'V10 未通过，跳过');
    }

    // ---------- 返回会话中心 → 生成报告闭环 ----------
    // mobile 实测取证（诊断 v2/v3）：抽屉面板 z-index:70 遮挡 backdrop 中心点击点（backdrop.click 超时）；
    // task 视图抽屉打开时 nav 非当前按钮均 disabled（「患儿模型」不可点）。
    // 真实用户路径：点 backdrop 顶部可见条带（抽屉面板之上，真实鼠标坐标点击）→ setMobileView('patient')
    // 抽屉关闭、backdrop 消失 → toolbar 顶部阶段签可点 → 点签后 spatialExam=false，再切回「当前任务」视图看问诊输入框。
    if (mobile) {
      await page.mouse.click(195, 120);
      await page.locator('button.mobile-drawer-backdrop').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    }
    await page.locator('button.stage-chip[aria-label="问诊与沟通"]').click({ timeout: 15000 });
    if (mobile) {
      await page.locator('.mobile-workspace-nav button', { hasText: '当前任务' }).click({ timeout: 10000 });
    }
    await page.waitForSelector('#question', { timeout: 20000 });
    const questionBackHome = await page.locator('#question').count();
    report(`${label} V12a 再次返回会话中心（#question 可见）`, questionBackHome === 1, `question=${questionBackHome}`);
    const finishBtn2 = page.locator('button.stage-next', { hasText: '生成训练报告' });
    await finishBtn2.click({ timeout: 15000 });
    await page.waitForSelector('.report-hero', { timeout: 45000 });
    report(`${label} V12b 生成训练报告→报告页渲染`, page.url().includes('/student/reports/'), 'url=/student/reports/…');
    await page.screenshot({ path: `${OUT}/viewstage-report-${label}.png`, fullPage: false });
    await page.close();
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
