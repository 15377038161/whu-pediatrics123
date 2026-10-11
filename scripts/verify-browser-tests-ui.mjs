/* 辅助检查 UI 闭环验收（真实浏览器，双视口 390×844 / 1440×900）：
 *
 * 口径（与 verify-browser-interactive.mjs 一致）：经 node 直连 Supabase 获取既有学生会话，
 * 按官方 supabase-js 存储格式注入浏览器 localStorage 创造可测试登录态——仅是界面条件测试手段，
 * 非完整邮箱密码登录验收。仅使用既有演示学生账号，不新建账号；只做本人会话合法操作。
 *
 * 会话 A（guided，peds-respiratory-001 教学固定病例）：
 *  1. 阶段直达：点「辅助检查选择」阶段签 → 4 项检查目录渲染
 *  2. 下单前拒读：目录与整页不含任何检查结果文本（以胸部影像结果特征片段判定，不打印正文）
 *  3. 下单后结果展示：点「胸部影像」→ 本轮 /api/agent/turn 200 → 反馈「与当前证据相符」
 *     → 实时病例记录出现「胸部影像」证据项 → 整页含结果文本
 *  4. 重复下单禁用：已下单按钮 disabled 且 data-ordered="true"
 *  5. 低价值检查明确反馈：点「头颅MRI」→ 反馈含「低价值」→ 记录出现「头颅MRI」证据项
 *  6. 缺资料明确提示（查体无规则组合）：查体阶段 手卫生 → 体温计×口咽（无预置规则组合）
 *     → 反馈含「资料未提供」（fail-closed：不编造体征）
 *
 * 会话 B（guided，来源病例 teacher-川崎病，走真实 RPC 先记单后取结果链路）：
 *  7. 来源病例检查目录可见（label/indication，无结果文本）
 *  8. 下单前拒读：下单前整页不含本轮返回的结果文本
 *  9. 下单后结果展示：本轮响应结果文本出现在 .source-result-list（事件摘要 label：结果）
 * 10. 重复下单禁用：首项按钮 disabled + data-ordered="true"
 *
 * 输出仅 PASS/FAIL/计数/长度/布尔，零患者正文、零凭据；截图存 artifacts/browser-acceptance。
 * 用法：BROWSER_CRED_FILE=/path/to/cred node scripts/verify-browser-tests-ui.mjs
 * 环境要求同 verify-browser-interactive.mjs（PW_CORE_PATH / PLAYWRIGHT_BROWSERS_PATH /
 * LD_LIBRARY_PATH / FONTCONFIG_FILE，见验收记录第七节环境突破）。
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.BROWSER_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const OUT = process.env.BROWSER_SCREENSHOT_DIR ?? 'artifacts/browser-acceptance';
const CRED_FILE = process.env.BROWSER_CRED_FILE;
const STORAGE_KEY = 'luojia-peds-auth';
const SOURCE_CASE_ID = process.env.TESTS_UI_SOURCE_CASE ?? 'teacher-川崎病';
/** 教学固定病例（非真实患者）胸部影像结果特征片段——仅用于包含判定，不打印。 */
const CHEST_RESULT_FRAG = '斑片状浸润影';

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

async function createTrainingSession(accessToken, caseId) {
  const resp = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(caseId ? { mode: 'guided', caseId } : { mode: 'guided' }),
  });
  const body = await resp.json().catch(() => null);
  const id = body?.data?.session?.id ?? body?.data?.id;
  if (!id) throw new Error(`会话创建失败 status=${resp.status}`);
  return id;
}

const norm = (text) => (text ?? '').replace(/\s+/g, '');

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

/** 等待页面出现 /api/agent/turn 的 POST 响应（本轮），返回 { status, newMessages }。
 *  waitForResponse 失败（点击未发生/上下文关闭）时返回 status=0 空结果，由调用方断言体现，
 *  避免 race 下未捕获的 promise rejection 中断整个脚本。 */
async function nextTurn(page, timeoutMs) {
  try {
    const resp = await page.waitForResponse(
      (r) => r.url().includes('/api/agent/turn') && r.request().method() === 'POST',
      { timeout: timeoutMs },
    );
    let newMessages = [];
    try {
      const body = await resp.json();
      newMessages = Array.isArray(body?.data?.newMessages) ? body.data.newMessages : [];
    } catch { /* 缺失由返回方断言体现 */ }
    return { status: resp.status(), newMessages };
  } catch {
    return { status: 0, newMessages: [] };
  }
}

/** 训练页通用前置：注入会话 → 打开训练工作台。 */
async function openTraining(ctx, authSession, sessionId, label) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(([k, a, u]) => {
    localStorage.setItem(k, a);
    localStorage.setItem(k + '-user', u);
  }, [STORAGE_KEY, JSON.stringify(authSession), JSON.stringify({ user: authSession.user })]);
  await page.goto(`${BASE}/student/training?session=${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.training-toolbar', { timeout: 60000 });
  await page.waitForTimeout(800);
  return page;
}

async function gotoStage(page, chipLabel, mobile) {
  const chip = page.locator(`button.stage-chip[aria-label="${chipLabel}"]`);
  if ((await chip.getAttribute('data-current')) !== 'true') await chip.click({ timeout: 15000 });
  await page.waitForSelector(`button.stage-chip[aria-label="${chipLabel}"][data-current="true"]`, { timeout: 20000 });
  const backdrop = page.locator('button.mobile-drawer-backdrop');
  if (await backdrop.count()) await backdrop.click({ timeout: 5000 }).catch(() => {});
  if (mobile) await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 });
}

/* ---------- 会话 A：教学固定病例检查闭环 ---------- */
async function runGuidedCase(browser, w, h, label, mobile, authSession) {
  const consoleErrors = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`); });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
  try {
    const sessionId = await createTrainingSession(authSession.access_token, 'peds-respiratory-001');
    const page2 = await openTraining(ctx, authSession, sessionId, label);
    page2.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`); });
    page2.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
    await page.close();
    const p = page2;

    // 1. 无规则组合明确反馈（教学固定病例口径：「器材与部位不匹配」，不编造体征）。
    //    口径注意（agent-engine handleExam 实证）：「资料未提供」仅用于来源病例；
    //    演示病例无规则组合的产品口径是「器材与部位不匹配，未解锁任何深层体征」
    //    （代码注释明示「演示病例保持原有『器材与部位不匹配』口径」）——来源病例的
    //    「资料未提供」由会话 B（teacher-川崎病）验证。
    //    操作顺序口径：先查体（triage→exam）后检查（exam→tests），stage 单调前进——
    //    若先开单再点回查体阶段签，DB 防回退触发器以 SESSION_STAGE_REGRESSION 返回 409
    //    （首轮运行实测），那是脚本操作序列非法，不是产品缺陷。
    await gotoStage(p, '可视化体格检查', mobile);
    await p.waitForSelector('.exam-tool-selector button.tool', { timeout: 20000 });
    await p.locator('.exam-tool-selector button.tool', { hasText: '手卫生' }).first().click({ timeout: 10000 });
    await p.waitForSelector('.exam-observation[data-status]', { state: 'attached', timeout: 30000 });
    await p.locator('.exam-tool-selector button.tool', { hasText: '体温计' }).first().click({ timeout: 10000 });
    const mouthHotspot = p.locator('button.hotspot[aria-label="使用当前器材检查口咽"]');
    await mouthHotspot.waitFor({ state: 'visible', timeout: 15000 });
    const noRuleP = nextTurn(p, 60000);
    await mouthHotspot.click({ timeout: 10000 });
    const noRule = await noRuleP;
    report(`${label} A1a 无规则组合响应200`, noRule.status === 200);
    await p.waitForFunction(() => (document.querySelector('.feedback')?.textContent ?? '').includes('不匹配'), null, { timeout: 20000 }).catch(() => {});
    const noRuleFeedback = await p.evaluate(() => document.querySelector('.feedback')?.textContent ?? '');
    report(`${label} A1b 无规则组合明确反馈（不匹配口径）`, noRuleFeedback.includes('不匹配'), noRuleFeedback ? `反馈长度=${noRuleFeedback.length}` : '反馈为空');
    await p.screenshot({ path: `${OUT}/tests-norule-${label}.png`, fullPage: false });

    // 2. 阶段直达 + 目录渲染（exam→tests 前进）
    await gotoStage(p, '辅助检查选择', mobile);
    await p.waitForSelector('.choice-list .choice', { timeout: 20000 });
    const choiceCount = await p.locator('.choice-list .choice').count();
    report(`${label} A2 检查目录渲染`, choiceCount === 4, `条目=${choiceCount}`);

    // 3. 下单前拒读：整页不含结果文本
    const bodyBefore = await p.evaluate(() => document.body.innerText);
    report(`${label} A3 下单前拒读（无结果文本）`, !norm(bodyBefore).includes(norm(CHEST_RESULT_FRAG)));

    // 4. 下单后结果展示（胸部影像）
    const turnP = nextTurn(p, 60000);
    await p.locator('.choice-list .choice', { hasText: '胸部影像' }).first().click({ timeout: 15000 });
    const turn = await turnP;
    const turnMsg = (turn.newMessages.at(-1)?.content ?? '').trim();
    report(`${label} A4a 下单响应200且含结果`, turn.status === 200 && norm(turnMsg).includes(norm(CHEST_RESULT_FRAG)), `status=${turn.status} msgLen=${turnMsg.length}`);
    await p.waitForFunction((frag) => (document.querySelector('.feedback')?.textContent ?? '').includes('相符'), '相符', { timeout: 20000 }).catch(() => {});
    const feedbackText = await p.evaluate(() => document.querySelector('.feedback')?.textContent ?? '');
    report(`${label} A4b 下单后反馈相符`, feedbackText.includes('与当前证据相符'));
    if (mobile) await p.click('.mobile-workspace-nav button >> nth=2', { timeout: 10000 });
    await p.waitForSelector('.evidence-log .evidence-item', { timeout: 20000 });
    const hasChestItem = await p.locator('.evidence-log .evidence-item', { hasText: '胸部影像' }).count();
    report(`${label} A4c 记录出现检查证据项`, hasChestItem > 0);
    const bodyAfter = await p.evaluate(() => document.body.innerText);
    report(`${label} A4d 下单后结果展示（含结果文本）`, norm(bodyAfter).includes(norm(CHEST_RESULT_FRAG)));

    // 5. 重复下单禁用
    const chestBtn = p.locator('.choice-list .choice', { hasText: '胸部影像' }).first();
    if (mobile) await p.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 });
    report(`${label} A5 重复下单禁用`, (await chestBtn.getAttribute('data-ordered')) === 'true' && await chestBtn.isDisabled());

    // 6. 低价值检查明确反馈（头颅 MRI）
    // 注意：UI 目录标签为「头颅 MRI」（带空格），服务端事件摘要为「头颅MRI」（无空格）——
    // 两处均用「头颅」宽松匹配，避免空格差异导致选择器落空（首轮运行即因此超时）。
    const lowP = nextTurn(p, 60000);
    await p.locator('.choice-list .choice', { hasText: '头颅' }).first().click({ timeout: 15000 });
    const low = await lowP;
    report(`${label} A6a 低价值下单响应200`, low.status === 200);
    await p.waitForFunction(() => (document.querySelector('.feedback')?.textContent ?? '').includes('低价值'), null, { timeout: 20000 }).catch(() => {});
    const lowFeedback = await p.evaluate(() => document.querySelector('.feedback')?.textContent ?? '');
    report(`${label} A6b 低价值明确反馈`, lowFeedback.includes('低价值'));
    if (mobile) await p.click('.mobile-workspace-nav button >> nth=2', { timeout: 10000 });
    await p.waitForSelector('.evidence-log .evidence-item', { timeout: 20000 });
    const hasLowItem = await p.locator('.evidence-log .evidence-item', { hasText: '头颅' }).count();
    report(`${label} A6c 低价值已记录证据项`, hasLowItem > 0);
    await p.screenshot({ path: `${OUT}/tests-lowvalue-${label}.png`, fullPage: false });
  } catch (e) {
    report(`${label} A 视口流程`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
  } finally {
    report(`${label} A console 无错误`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' ; ').slice(0, 150));
    await ctx.close();
  }
}

/* ---------- 会话 B：来源病例检查闭环（真实 RPC 先记单后取结果） ---------- */
async function runSourceCase(browser, w, h, label, mobile, authSession) {
  const consoleErrors = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`); });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
  try {
    const sessionId = await createTrainingSession(authSession.access_token, SOURCE_CASE_ID);
    const p = await openTraining(ctx, authSession, sessionId, label);
    p.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`); });
    p.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));

    // B0. 缺资料明确提示（来源病例口径）：查体无规则组合 → fail-closed「资料未提供」，
    //     不补正常结果、不虚构体征（与演示病例「不匹配」口径区分，由会话 A 验证）。
    //     组合选择沿用 verify-exam-tests-acceptance 实证口径：体温计×口咽（该来源病例无此规则）。
    await gotoStage(p, '可视化体格检查', mobile);
    await p.waitForSelector('.exam-tool-selector button.tool', { timeout: 20000 });
    await p.locator('.exam-tool-selector button.tool', { hasText: '手卫生' }).first().click({ timeout: 10000 });
    await p.waitForSelector('.exam-observation[data-status]', { state: 'attached', timeout: 30000 });
    await p.locator('.exam-tool-selector button.tool', { hasText: '体温计' }).first().click({ timeout: 10000 });
    const srcMouth = p.locator('button.hotspot[aria-label="使用当前器材检查口咽"]');
    await srcMouth.waitFor({ state: 'visible', timeout: 15000 });
    const srcNoRuleP = nextTurn(p, 60000);
    await srcMouth.click({ timeout: 10000 });
    const srcNoRule = await srcNoRuleP;
    report(`${label} B0a 来源病例无规则组合响应200`, srcNoRule.status === 200);
    await p.waitForFunction(() => (document.querySelector('.feedback')?.textContent ?? '').includes('资料未提供'), null, { timeout: 20000 }).catch(() => {});
    const srcNoRuleFeedback = await p.evaluate(() => document.querySelector('.feedback')?.textContent ?? '');
    report(`${label} B0b 缺资料明确提示（资料未提供口径）`, srcNoRuleFeedback.includes('资料未提供'));
    await p.screenshot({ path: `${OUT}/tests-source-norule-${label}.png`, fullPage: false });

    // 7. 来源病例目录可见（无结果文本）；exam→tests 前进
    await gotoStage(p, '辅助检查选择', mobile);
    await p.waitForSelector('.choice-list .choice', { timeout: 20000 });
    const catCount = await p.locator('.choice-list .choice').count();
    report(`${label} B1 来源病例目录渲染`, catCount > 0, `条目=${catCount}`);
    const bodyBefore = norm(await p.evaluate(() => document.body.innerText));
    const preList = norm(await p.evaluate(() => document.querySelector('.source-result-list')?.textContent ?? ''));
    report(`${label} B2 下单前结果区为空`, preList.length === 0, `len=${preList.length}`);

    // 8+9. 首单：拒读 + 结果展示（不打印结果正文）
    const firstChoice = p.locator('.choice-list .choice').first();
    const turnP = nextTurn(p, 90000);
    await firstChoice.click({ timeout: 15000 });
    const turn = await turnP;
    const resultMsg = (turn.newMessages.at(-1)?.content ?? '').trim();
    const frag = norm(resultMsg).slice(0, 12);
    report(`${label} B3a 首单响应200且结果非空非缺资料`, turn.status === 200 && resultMsg.length > 0 && !resultMsg.includes('资料未提供'), `status=${turn.status} msgLen=${resultMsg.length}`);
    report(`${label} B3b 下单前拒读（整页无该结果文本）`, frag.length >= 8 && !bodyBefore.includes(frag));
    // 注意：waitForFunction 回调在浏览器上下文执行，Node 侧 norm 不可见——normalize 逻辑必须内联。
    await p.waitForFunction((f) => (document.querySelector('.source-result-list')?.textContent ?? '').replace(/\s+/g, '').includes(f), frag, { timeout: 20000 }).catch(() => {});
    const listText = norm(await p.evaluate(() => document.querySelector('.source-result-list')?.textContent ?? ''));
    report(`${label} B3c 下单后结果区展示结果`, listText.includes(frag));

    // 10. 重复下单禁用
    report(`${label} B4 重复下单禁用`, (await firstChoice.getAttribute('data-ordered')) === 'true' && await firstChoice.isDisabled());
    await p.screenshot({ path: `${OUT}/tests-source-${label}.png`, fullPage: false });
  } catch (e) {
    report(`${label} B 视口流程`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
  } finally {
    report(`${label} B console 无错误`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' ; ').slice(0, 150));
    await ctx.close();
  }
}

const cred = loadCred(CRED_FILE);
const authSession = await fetchSession(cred);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
for (const [w, h, label] of [[390, 844, '390px'], [1440, 900, 'desktop']]) {
  const mobile = w <= 480;
  await runGuidedCase(browser, w, h, label, mobile, authSession);
  await runSourceCase(browser, w, h, label, mobile, authSession);
}
await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`SUMMARY ${pass}/${results.length} PASS`);
process.exit(pass === results.length ? 0 : 1);
