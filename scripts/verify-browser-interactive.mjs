/* 真实浏览器双视口界面条件验收（沙箱/本地环境可复跑版）：
 *
 * 口径（重要）：本脚本通过「node 直连 Supabase 获取既有学生会话 + 按官方 supabase-js
 * 存储格式注入浏览器 localStorage」在沙箱内创造可测试登录态，验证登录后的界面交互行为
 * （落地页/训练台/单聊天框/查体）。这仅是界面条件测试手段，不是完整邮箱密码登录或
 * 教师 OAuth 端到端验收，也不以伪装 UA/伪造 Origin/转发代理规避任何网关限制。
 *
 * 验收项（双视口 390×844 / 1440×900）：
 *  1. 落地页渲染（标题/双端入口卡）+ 390px 无横向溢出
 *  2. 会话注入后挂载自愈跳转学生端
 *  3. 学生首页 → 训练工作台加载 → triage 开场 → 单聊天框真实 LLM 回复（仅 390px，控制成本；
 *     断言=同轮证据链：①本轮 /api/agent/turn 请求捕获 sessionId+clientEventId；②响应 200 且响应体
 *     newMessages 含本轮 child/parent 回复；③DOM 新增 assistant 消息；④按该会话该事件精确匹配
 *     agent_call_records 且 execution=model。不以消息数量/长度为通过依据，不以学生全局最新
 *     agent_call_records 代替本轮证据）
 *  4. 手卫生 → 听诊器 → 胸部热点查体（data-status）
 *  5. 双视口 console/page 错误收集
 *
 * 环境要求（沙箱外/新环境需自备）：
 *  - node + 可用的 playwright-core（环境变量 PW_CORE_PATH 指向其 node_modules，或已全局安装）
 *  - PLAYWRIGHT_BROWSERS_PATH 指向浏览器安装目录（chromium-headless-shell）
 *  - 无系统浏览器环境需 LD_LIBRARY_PATH/FONTCONFIG_FILE 指向解包依赖（参考验收记录第七节）
 *
 * 用法：
 *  BROWSER_CRED_FILE=/path/to/cred node scripts/verify-browser-interactive.mjs
 * 凭据文件格式：email: xxx / password: xxx（键值对文本，不入库不入 git）
 * 输出仅 PASS/FAIL/计数/状态码/消息长度，零患者正文、零凭据。
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
  console.error('环境准备：1) 独立目录安装 playwright-core 并设 PW_CORE_PATH；2) 设 PLAYWRIGHT_BROWSERS_PATH 指向浏览器；3) 无系统浏览器时设 LD_LIBRARY_PATH/FONTCONFIG_FILE（详见验收记录第七节环境突破）。');
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

/** 按本轮 turn 的 sessionId+clientEventId 精确匹配 agent_call_records（同轮证据，非全局最新）。
 *  旧实现取学生全局最新记录并比较 client_event_id 变化——不能排除旧记录/其他会话/并发轮次，
 *  已废弃。精确匹配失败返回 null，不抛出。 */
async function agentCallByEvent(authSession, sessionId, clientEventId) {
  const url = process.env.CODER_SUPABASE_URL, key = process.env.CODER_SUPABASE_ANON_KEY, tid = process.env.CODER_SUPABASE_TENANT_ID;
  try {
    const resp = await fetch(`${url}/rest/v1/agent_call_records?select=client_event_id,execution,model_name,created_at&session_id=eq.${sessionId}&client_event_id=eq.${encodeURIComponent(clientEventId)}`, {
      headers: { apikey: key, Authorization: `Bearer ${authSession.access_token}`, 'X-Instance-ID': tid },
    });
    if (!resp.ok) return null;
    const rows = await resp.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

async function runViewport(browser, w, h, label, session, doChat) {
  const consoleErrors = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`); });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
  try {
    // 1. 落地页渲染
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('button.login-entry-card-student', { timeout: 15000 });
    report(`${label} 落地页渲染`, true, `title=${await page.title()}`);
    if (w <= 480) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      report(`${label} 无横向溢出`, overflow <= 1, `delta=${overflow}px`);
    }
    await page.screenshot({ path: `${OUT}/landing-${label}.png`, fullPage: false });

    // 2. 会话注入 → 挂载自愈路由（界面条件测试手段，见文件头口径说明）
    await page.evaluate(([k, a, u]) => {
      localStorage.setItem(k, a);
      localStorage.setItem(k + '-user', u);
    }, [STORAGE_KEY, JSON.stringify(session), JSON.stringify({ user: session.user })]);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.location.pathname.startsWith('/student'), null, { timeout: 30000 });
    report(`${label} 会话自愈跳转学生端`, true, `URL=${page.url().replace(BASE, '')}`);

    // 3. 学生首页 → 训练工作台
    await page.waitForSelector('a.btn-primary', { timeout: 20000 });
    await page.screenshot({ path: `${OUT}/student-home-${label}.png`, fullPage: false });
    if (doChat) {
      // 聊天断言口径：不点击「继续训练」恢复任意状态的遗留活跃会话（可能已在查体阶段，textarea
      // 不存在导致聊天步骤被静默跳过）。改为显式创建新会话直达训练页，保证从分诊阶段进入问诊聊天。
      const resp = await fetch(`${BASE}/api/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'guided' }) });
      const body = await resp.json().catch(() => null);
      const newId = body?.data?.session?.id ?? body?.data?.id;
      if (!newId) throw new Error(`新会话创建失败 status=${resp.status}`);
      await page.goto(`${BASE}/student/training?session=${newId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      await page.click('a.btn-primary');
    }
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });
    report(`${label} 训练工作台加载`, true);
    const introBtn = page.locator('.training-primary button.btn-primary', { hasText: '进入问诊与沟通' });
    if (await introBtn.count()) {
      await introBtn.first().click({ timeout: 15000 });
      await page.waitForSelector('textarea#question', { timeout: 30000 });
    } else {
      await page.waitForSelector('textarea#question, .exam-tool-selector', { timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/training-${label}.png`, fullPage: false });

    // 4. 单聊天框真实 LLM 回复（仅单视口执行，控制成本；断言口径收紧，不输出回复正文）
    // 断言口径：不再以「消息数量增加/末条长度>10」作为通过依据，而是：
    //  ① DOM 新增 data-actor∈{child,parent,tutor} 的 assistant 消息（排除 student/system）；
    //  ② 服务端 agent_call_records 出现本轮新记录且 execution=model（真实 LLM 链路证据，非 UI 现象推断）。
    if (doChat) {
      if (!(await page.$('textarea#question'))) {
        // 前置条件缺失显式 FAIL：不允许聊天断言被静默跳过后仍计为通过
        report(`${label} 聊天前置条件`, false, 'textarea#question 未出现');
      } else {
      const beforeCount = await page.evaluate(() => document.querySelectorAll('.message-list.history-chat > .message').length);
      // 问题文本选择口径：不得命中 detectSpokenIntervention 的干预模式（如「小朋友…告诉我」会走
      // handleIntervention，无 runtime 落库 deterministic——旧脚本即因此误报），且需命中病例意图
      // 关键词（fever/onset）确保走 renderRoleReply 的 LLM 路径。「孩子发烧几天了？」双条件均满足。
      await page.fill('textarea#question', '孩子发烧几天了？');
      // 同轮证据口径（用户要求）：从浏览器本次 /api/agent/turn 请求体捕获 sessionId+clientEventId，
      // 精确匹配该会话该事件的落库记录；不以学生全局最新 agent_call_records 代替本轮证据
      // （旧记录/其他会话/并发轮次不可排除，全局最新法已废弃）。
      const turnRespPromise = page.waitForResponse(
        (resp) => resp.url().includes('/api/agent/turn') && resp.request().method() === 'POST',
        { timeout: 90000 },
      );
      await page.click('button.btn-primary:not([disabled])');
      const turnResp = await turnRespPromise;
      let turnReq = {};
      try { turnReq = JSON.parse(turnResp.request().postData() ?? '{}'); } catch { /* 缺失由下方断言体现 */ }
      const turnSessionId = turnReq.sessionId ?? null;
      const turnEventId = turnReq.clientEventId ?? null;
      report(`${label} 本轮turn请求捕获`, Boolean(turnSessionId && turnEventId), `sessionId=${turnSessionId ? turnSessionId.slice(0, 8) : '缺失'} clientEventId=${turnEventId ? turnEventId.slice(0, 8) : '缺失'}`);
      report(`${label} 本轮turn响应状态`, turnResp.status() === 200, `status=${turnResp.status()}`);
      // 响应体核对：本轮实际新增患者/家长回复（结构校验 actor∈{child,parent} 且内容非空，不打印正文）
      let respReply = null;
      try {
        const respBody = await turnResp.json();
        const newMessages = Array.isArray(respBody?.data?.newMessages) ? respBody.data.newMessages : [];
        respReply = newMessages.find((m) => (m.actor === 'child' || m.actor === 'parent') && ((m.content ?? '')).trim().length > 0) ?? null;
      } catch { /* 解析失败由 respReply=null 体现 */ }
      report(`${label} 响应体含本轮患者/家长回复`, Boolean(respReply), respReply ? `actor=${respReply.actor}` : '响应体未含child/parent回复');
      await page.waitForFunction((n) => {
        const msgs = document.querySelectorAll('.message-list.history-chat > .message');
        for (let i = n; i < msgs.length; i++) {
          const actor = msgs[i].getAttribute('data-actor');
          if (actor && actor !== 'student' && actor !== 'system' && ((msgs[i].querySelector('.message-bubble')?.textContent ?? '').trim().length > 0)) return true;
        }
        return false;
      }, beforeCount, { timeout: 90000 });
      const reply = await page.evaluate((n) => {
        const msgs = document.querySelectorAll('.message-list.history-chat > .message');
        for (let i = n; i < msgs.length; i++) {
          const actor = msgs[i].getAttribute('data-actor');
          if (actor && actor !== 'student' && actor !== 'system') {
            return { actor, len: (msgs[i].querySelector('.message-bubble')?.textContent ?? '').trim().length };
          }
        }
        return null;
      }, beforeCount);
      report(`${label} 聊天新增assistant消息`, Boolean(reply), reply ? `data-actor=${reply.actor} 回复长度=${reply.len}字` : '未捕获新增assistant消息');
      // 精确匹配落库：该会话该事件的 agent_call_records 必须存在且 execution=model
      // （deterministic=非 LLM 路径；model_fallback=模型调用失败降级；两者均不算模型成功）
      let rec = null;
      if (turnSessionId && turnEventId) {
        for (let i = 0; i < 10 && !rec; i++) {
          rec = await agentCallByEvent(session, turnSessionId, turnEventId);
          if (!rec) await page.waitForTimeout(1500);
        }
      }
      report(`${label} 同轮记录execution=model`, rec?.execution === 'model', rec ? `execution=${rec.execution} model=${rec.model_name ?? ''}` : '该会话该事件记录未找到');
      await page.screenshot({ path: `${OUT}/chat-reply-${label}.png`, fullPage: false });
      }
    }

    // 5. 查体：切阶段 →（移动端先切器材抽屉）→ 手卫生 → 听诊器 → 胸部热点
    try {
      const examChip = page.locator('button.stage-chip[aria-label="可视化体格检查"]');
      if ((await examChip.getAttribute('data-current')) !== 'true') {
        await examChip.click({ timeout: 15000 });
      }
      await page.waitForSelector('.stage-chip[aria-label="可视化体格检查"][data-current="true"]', { timeout: 20000 });
      const backdrop = page.locator('button.mobile-drawer-backdrop');
      if (await backdrop.count()) await backdrop.click({ timeout: 5000 }).catch(() => {});
      if (w <= 480) {
        await page.click('.mobile-workspace-nav button >> nth=0', { timeout: 10000 });
      }
      await page.waitForSelector('.exam-tool-selector button.tool', { timeout: 15000 });
      const hygiene = page.locator('.exam-tool-selector button.tool', { hasText: '手卫生' }).first();
      await hygiene.click({ timeout: 10000 });
      await page.waitForSelector('.exam-observation[data-status]', { state: 'attached', timeout: 30000 });
      report(`${label} 手卫生完成`, true, `data-status=${await page.getAttribute('.exam-observation', 'data-status')}`);
      const steth = page.locator('.exam-tool-selector button.tool', { hasText: '听诊器' }).first();
      await steth.click({ timeout: 10000 });
      const chest = page.locator('button.hotspot[aria-label="使用当前器材检查胸部"]');
      await chest.waitFor({ state: 'visible', timeout: 15000 });
      await chest.click({ timeout: 10000 });
      await page.waitForSelector('.exam-observation[data-tool="stethoscope"]', { state: 'attached', timeout: 30000 });
      const status = await page.getAttribute('.exam-observation[data-tool="stethoscope"]', 'data-status');
      report(`${label} 听诊器+胸部热点查体`, status === 'success', `data-status=${status}`);
      await page.screenshot({ path: `${OUT}/exam-${label}.png`, fullPage: false });
    } catch (e) {
      report(`${label} 查体流程`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  } catch (e) {
    report(`${label} 视口流程`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
  } finally {
    report(`${label} console 无错误`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' ; ').slice(0, 150));
    await ctx.close();
  }
}

const cred = loadCred(CRED_FILE);
const session = await fetchSession(cred);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await runViewport(browser, 390, 844, '390px', session, true);
await runViewport(browser, 1440, 900, 'desktop', session, false);
await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`SUMMARY ${pass}/${results.length} PASS`);
process.exit(pass === results.length ? 0 : 1);
