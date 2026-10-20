/* 语音链真实浏览器验收脚本（fail-closed，D-边界-01 收尾口径）：
 *
 * ⚠ 凭据边界（D-边界-01）：本脚本只在 BROWSER_CRED_FILE 指向【既有且经用户明确授权】的
 * 受控凭据时才运行；缺少该凭据时 fail-closed（列待验收，退出码 2），不做任何自动注册、
 * 不新增预览登录、不合成 JWT。历史上 D-验收-01 批次曾违规新建探针账号补测，该账号浏览器
 * 结果（0/1 PASS，本就失败）不计入已授权验收，其自动注册入口已删除；账号处置由用户决定。
 *
 * 口径（与 verify-browser-entries-ui.mjs 一致）：经 node 直连 Supabase 获取既有学生会话，
 * 按官方 supabase-js 存储格式注入浏览器 localStorage 创造可测试登录态——仅界面条件测试手段，
 * 非完整邮箱密码登录验收。只做本人会话合法操作；账号须为 account_kind=test 类受控测试身份。
 *
 * 验证范围（单视口 1440×900，输出仅 PASS/FAIL/布尔/计数，零患者正文、零凭据、零 URL）：
 *  S1 普通病例（guided）训练台：语音工具栏渲染 = 真实 /api/speech/capabilities 探测在
 *     真实浏览器返回 asr/tts turn-based（启用状态不来自前端常量）
 *  S2 切换语音输入：VoiceInput idle 态渲染（按轮录音入口）
 *  S3 无麦克风点开始录音：优雅降级（权限错误提示 + 可继续文字，不崩溃）
 *  S4 文字回退发送问诊：真实 agent 回合正常（训练进度不受语音不可用影响）
 *  S5 角色播报真实 TTS：浏览器内 /api/speech/tts 响应 200 且含 audioUrl（签名 URL 不打印）
 *  S6 专项沟通（practice focus=communication）：CommunicationCall 模拟通话渲染，
 *     speechReady 时语音输入入口可用、无降级提示
 *  S7 OSCE/immersive 沟通站与 guided 共用同一 conversationContent 渲染分支（源码共链），
 *     不在本脚本单独浏览器断言——已在验收记录如实列明。
 *
 * 明确未验收（如实标注，不冒充）：
 *  - 真实麦克风录音 → ASR（沙箱无麦克风设备，getUserMedia 必然失败，仅验降级路径；
 *    ASR SDK 层真实调用已由 scripts/verify-speech-sdk-smoke.ts 与 tests/speech-routes.test.ts 覆盖）
 *  - 扬声器实际播放音质 / 手机端听感（无头环境无声卡、无真机）
 *  - 390px 移动端语音 UI（本脚本单视口，未双视口复验）
 *
 * 用法：source scripts/browser-env.sh && BROWSER_CRED_FILE=<用户授权的既有受控凭据路径> \
 *       node scripts/verify-browser-speech-ui.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';


const BASE = process.env.BROWSER_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const OUT = process.env.BROWSER_SCREENSHOT_DIR ?? 'artifacts/browser-acceptance';
const CRED_FILE = process.env.BROWSER_CRED_FILE;
const STORAGE_KEY = 'luojia-peds-auth';


if (!CRED_FILE) {
  console.error('FATAL 缺少 BROWSER_CRED_FILE：语音链浏览器验收需要【既有且经用户明确授权】的受控学生凭据（JSON：email/password）。');
  console.error('fail-closed：不自动注册、不新增预览登录、不合成 JWT。以下浏览器链路项列【待验收】：S1 语音工具栏真实探测、S2 语音输入渲染、S3 无麦克风降级、S4 文字回退续训、S5 角色播报 TTS、S6 模拟通话渲染。');
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
  const raw = readFileSync(file, 'utf8');
  // 兼容两种格式：bootstrap 写出的 0600 JSON（{"email":...,"password":...}）与既有键值对文本
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.email === 'string' && typeof parsed?.password === 'string') {
      return { email: parsed.email, password: parsed.password };
    }
  } catch { /* 非 JSON，回落键值对解析 */ }
  const map = new Map();
  for (const line of raw.split('\n')) {
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


async function createTrainingSession(accessToken, body) {
  const resp = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await resp.json().catch(() => null);
  const id = parsed?.data?.session?.id ?? parsed?.data?.id;
  if (!id) throw new Error(`会话创建失败 mode=${body.mode} status=${resp.status}`);
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
  // dev 模式首次编译存在导航竞态（ERR_ABORTED 瞬态）：重试一次
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      break;
    } catch (e) {
      if (attempt === 0 && String(e).includes('ERR_ABORTED')) { await page.waitForTimeout(1500); continue; }
      throw e;
    }
  }
  return page;
}


async function main() {
  const cred = loadCred(CRED_FILE);
  const authSession = await fetchSession(cred);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const ttsResponses = [];
  let page;
  try {
    page = await ctx.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    // 全局收集 TTS 响应（初始角色消息入队即触发合成，监听必须在页面加载前挂好）
    page.on('response', async (resp) => {
      if (!resp.url().includes('/api/speech/tts')) return;
      let hasAudioUrl = false;
      try { const body = await resp.json(); hasAudioUrl = typeof body?.data?.audioUrl === 'string' && body.data.audioUrl.length > 0; } catch { /* 留 false */ }
      ttsResponses.push({ status: resp.status(), hasAudioUrl });
    });


    // ---------- 普通病例（guided）----------
    const guidedId = await createTrainingSession(authSession.access_token, { mode: 'guided' });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(([k, a, u]) => {
      localStorage.setItem(k, a);
      localStorage.setItem(k + '-user', u);
    }, [STORAGE_KEY, JSON.stringify(authSession), JSON.stringify({ user: authSession.user })]);
    const gotoTraining = async (sessionId) => {
      // dev 模式首次编译存在导航竞态（ERR_ABORTED 瞬态）：重试一次
      for (let attempt = 0; ; attempt++) {
        try {
          await page.goto(`${BASE}/student/training?session=${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          return;
        } catch (e) {
          if (attempt === 0 && String(e).includes('ERR_ABORTED')) { await page.waitForTimeout(1500); continue; }
          throw e;
        }
      }
    };
    await gotoTraining(guidedId);
    await page.waitForSelector('.training-toolbar', { timeout: 60000 });

    // S1 语音工具栏：speechReady = 真实能力探测（服务端最小 TTS/ASR 探测）在真实浏览器返回 turn-based
    await page.waitForSelector('.voice-toolbar', { timeout: 60000 });
    report('S1 guided 语音入口渲染（真实能力探测就绪）', true);

    // S2 切换语音输入 → VoiceInput idle 态
    await page.locator('.voice-toolbar button', { hasText: '语音输入' }).click({ timeout: 15000 });
    await page.waitForSelector('.voice-input[data-state="idle"]', { timeout: 15000 });
    report('S2 语音输入 idle 态渲染', true);

    // S3 无麦克风开始录音 → 优雅降级（错误提示 + 回 idle，可继续文字）
    await page.locator('button[aria-label="开始录音（按轮录音，录音后确认转写再发送）"]').click({ timeout: 15000 });
    await page.waitForSelector('.voice-error', { timeout: 20000 });
    const errText = (await page.locator('.voice-error').textContent() ?? '').trim();
    const stateAfterMicFail = await page.locator('.voice-input').getAttribute('data-state');
    report('S3 无麦克风优雅降级（提示+回idle）',
      stateAfterMicFail === 'idle' && /麦克风|录音|文字/.test(errText),
      `state=${stateAfterMicFail} 提示含关键词=${/麦克风|录音|文字/.test(errText)}`);

    // S4 文字回退：切回文字 → 发送中性问诊 → 真实 agent 回合产生角色回复
    await page.locator('.voice-toolbar button', { hasText: '改用文字输入' }).click({ timeout: 15000 });
    await page.waitForSelector('#question', { timeout: 15000 });
    const before = await page.locator('.message-list .message').count();
    await page.fill('#question', '小朋友你好，可以告诉我现在哪里不舒服吗？');
    await page.locator('.composer-actions button', { hasText: '发送' }).click({ timeout: 15000 });
    await page.waitForFunction((prev) => document.querySelectorAll('.message-list .message').length > prev, before, { timeout: 90000 });
    report('S4 文字回退发送问诊（agent 回合正常）', true, `消息数 ${before}→${await page.locator('.message-list .message').count()}`);
    await page.screenshot({ path: `${OUT}/speech-guided-desktop.png`, fullPage: false });

    // S5 角色播报真实 TTS：浏览器内 /api/speech/tts 200 + audioUrl（签名 URL 不打印）
    // 初始角色消息与问诊回复均会入队合成；等待任一真实响应（播放本身无头环境无声卡，未验收）
    const deadline = Date.now() + 90000;
    while (ttsResponses.length === 0 && Date.now() < deadline) await page.waitForTimeout(500);
    const ttsOk = ttsResponses.length > 0 && ttsResponses.some((r) => r.status === 200 && r.hasAudioUrl);
    report('S5 角色播报真实 TTS 链路（200+audioUrl）', ttsOk,
      `tts响应数=${ttsResponses.length} 200且含URL=${ttsResponses.filter((r) => r.status === 200 && r.hasAudioUrl).length}`);

    // ---------- 专项沟通（practice focus=communication）----------
    const practiceId = await createTrainingSession(authSession.access_token, { mode: 'practice', focus: 'communication' });
    await gotoTraining(practiceId);
    await page.waitForSelector('.call-input', { timeout: 60000 });
    // speechReady 时：默认语音输入态可用，且无「语音暂不可用」降级提示
    await page.waitForSelector('.call-input-mode', { timeout: 15000 });
    const voiceIdle = await page.locator('.voice-input[data-state="idle"]').count();
    const fallbackNote = await page.locator('.call-fallback-note').count();
    report('S6 专项沟通模拟通话（CommunicationCall）语音入口',
      voiceIdle === 1 && fallbackNote === 0,
      `语音idle入口=${voiceIdle} 降级提示=${fallbackNote}`);
    await page.screenshot({ path: `${OUT}/speech-practice-desktop.png`, fullPage: false });

    // S7 OSCE/immersive 沟通站共用同链（源码共链，不在本脚本浏览器断言——验收记录如实列明）
    console.log('NOTE | S7 OSCE/immersive 沟通站与 guided 共用 conversationContent 渲染分支（源码共链）；真实麦克风录音→ASR、扬声器播放、390px 移动端语音 UI 为明确未验收项');
    report('console 无错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' ; ').slice(0, 150));
  } catch (e) {
    report('语音链浏览器流程', false, e instanceof Error ? e.message.split('\n')[0] : String(e));
  } finally {
    await ctx.close();
    await browser.close();
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`SUMMARY ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
}


void main();
