/* 语音与输入区真实浏览器验收（fail-closed）。
 *
 * 仅使用 BROWSER_CRED_FILE 指向的、既有且经用户明确授权的受控学生身份。
 * 不自动注册、不新增预览登录、不合成 JWT；凭据只从 0600 临时文件读取且不输出。
 * 本脚本验证界面条件，不替代完整邮箱密码登录或真实移动设备验收。
 *
 * 覆盖：加载零语音请求、默认播报关闭、语音/键盘切换保留草稿、单行与长文本高度、
 * 无麦克风降级、开启不补播历史、新回复真实 TTS、390px 无横向溢出、专项沟通同组件。
 * 明确不覆盖：真实麦克风采集后的 ASR 识别质量、扬声器音质、真机权限与听感。
 *
 * 用法：BROWSER_CRED_FILE=<受控凭据路径> node scripts/verify-browser-speech-ui.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.BROWSER_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const OUT = process.env.BROWSER_SCREENSHOT_DIR ?? 'artifacts/browser-acceptance';
const CRED_FILE = process.env.BROWSER_CRED_FILE;
const STORAGE_KEY = 'luojia-peds-auth';
const results = [];

if (!CRED_FILE) {
  console.error('FATAL 缺少 BROWSER_CRED_FILE：需要既有且经用户明确授权的受控学生凭据。');
  console.error('fail-closed：登录后输入区、麦克风、TTS、双视口与专项沟通流程均为未验收。');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

let chromium;
try {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(process.env.PW_CORE_PATH ?? 'playwright-core'));
} catch (error) {
  console.error(`FATAL playwright-core 不可用：${error instanceof Error ? error.message.split('\n')[0] : error}`);
  process.exit(2);
}

function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

function loadCred(file) {
  const raw = readFileSync(file, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.email === 'string' && typeof parsed?.password === 'string') {
      return { email: parsed.email, password: parsed.password };
    }
  } catch { /* 兼容既有键值对格式。 */ }
  const map = new Map();
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (match) map.set(match[1].toLowerCase(), match[2]);
  }
  const email = map.get('email');
  const password = map.get('password');
  if (!email || !password) throw new Error('受控凭据文件缺少 email/password');
  return { email, password };
}

async function fetchSession(cred) {
  const url = process.env.CODER_SUPABASE_URL;
  const key = process.env.CODER_SUPABASE_ANON_KEY;
  const tenant = process.env.CODER_SUPABASE_TENANT_ID;
  if (!url || !key || !tenant) throw new Error('缺少 CODER_SUPABASE_* 平台环境变量');
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'X-Instance-ID': tenant, 'content-type': 'application/json' },
    body: JSON.stringify(cred),
  });
  if (!response.ok) throw new Error(`登录失败 status=${response.status}`);
  const session = await response.json();
  if (!session.access_token) throw new Error('登录响应缺少 access_token');
  return session;
}

async function createTrainingSession(accessToken, body) {
  const response = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null);
  const id = parsed?.data?.session?.id ?? parsed?.data?.id;
  if (!id) throw new Error(`会话创建失败 mode=${body.mode} status=${response.status}`);
  return id;
}

function observeSpeechRequests(page) {
  const requests = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/speech/') || /\/api\/sessions\/[^/]+\/voice$/.test(path)) {
      requests.push({ path, method: request.method() });
    }
  });
  return requests;
}

async function injectAndGoto(context, authSession, path) {
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(([key, auth, user]) => {
    localStorage.setItem(key, auth);
    localStorage.setItem(`${key}-user`, user);
  }, [STORAGE_KEY, JSON.stringify(authSession), JSON.stringify({ user: authSession.user })]);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return page;
    } catch (error) {
      if (attempt === 0 && String(error).includes('ERR_ABORTED')) {
        await page.waitForTimeout(1500);
        continue;
      }
      throw error;
    }
  }
}

async function checkDraftAndLayout(page, mode, label) {
  const composer = page.locator(`.composer-card[data-mode="${mode}"]`);
  await composer.waitFor({ timeout: 60000 });
  const textarea = page.locator(`textarea#${mode === 'history' ? 'question' : 'communication-question'}`);
  await textarea.waitFor({ timeout: 15000 });
  const initialHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);
  report(`${label} 默认键盘单行输入`, initialHeight > 0 && initialHeight <= 52, `height=${Math.round(initialHeight)}`);
  report(`${label} 默认播报关闭`, await page.locator('.composer-audio-toggle[aria-pressed="false"]').count() === 1);

  await textarea.fill('保留这段草稿');
  await page.getByRole('button', { name: '切换为语音输入', exact: true }).click();
  await page.getByRole('button', { name: '按住说话，松开发送识别，上滑取消', exact: true }).waitFor();
  await page.getByRole('button', { name: '切换为键盘输入，保留当前草稿', exact: true }).click();
  report(`${label} 语音/键盘切换保留草稿`, await textarea.inputValue() === '保留这段草稿');

  await textarea.fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行\n第八行');
  const expandedHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);
  report(`${label} 长文本有限扩展`, expandedHeight > initialHeight && expandedHeight <= 121, `height=${Math.round(expandedHeight)}`);
  await textarea.fill('保留这段草稿');
}

async function main() {
  const authSession = await fetchSession(loadCred(CRED_FILE));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const consoleErrors = [];
  try {
    const guidedId = await createTrainingSession(authSession.access_token, { mode: 'guided' });
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await injectAndGoto(desktop, authSession, `/student/training?session=${guidedId}`);
    const speechRequests = observeSpeechRequests(page);
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    await checkDraftAndLayout(page, 'history', '桌面问诊');
    await page.waitForTimeout(800);
    report('加载与切换模式不主动调用语音接口', speechRequests.length === 0, `requests=${speechRequests.length}`);

    await page.getByRole('button', { name: '切换为语音输入', exact: true }).click();
    const hold = page.getByRole('button', { name: '按住说话，松开发送识别，上滑取消', exact: true });
    await hold.focus();
    await page.keyboard.down('Space');
    await page.waitForTimeout(250);
    await page.keyboard.up('Space');
    await page.locator('.voice-inline-notice').waitFor({ timeout: 20000 });
    const notice = await page.locator('.voice-inline-notice').textContent();
    report('无麦克风权限时优雅降级', /麦克风|录音|文字|权限/.test(notice ?? ''));
    await page.getByRole('button', { name: '切换为键盘输入，保留当前草稿', exact: true }).click();
    report('麦克风失败后草稿仍保留', await page.locator('textarea#question').inputValue() === '保留这段草稿');

    const ttsResponses = [];
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname !== '/api/speech/tts') return;
      let hasAudioUrl = false;
      try {
        const body = await response.json();
        hasAudioUrl = typeof body?.data?.audioUrl === 'string' && body.data.audioUrl.length > 0;
      } catch { /* 由断言报告失败。 */ }
      ttsResponses.push({ status: response.status(), hasAudioUrl });
    });
    await page.getByRole('button', { name: '开启 AI 回复语音播报', exact: true }).click();
    await page.waitForTimeout(800);
    report('开启播报不补播历史消息', ttsResponses.length === 0, `tts=${ttsResponses.length}`);

    const textarea = page.locator('textarea#question');
    await textarea.fill('孩子发烧几天了？');
    const before = await page.locator('.message-list .message').count();
    await page.getByRole('button', { name: '确认并发送当前草稿', exact: true }).click();
    await page.waitForFunction((count) => document.querySelectorAll('.message-list .message').length > count, before, { timeout: 90000 });
    const deadline = Date.now() + 90000;
    while (ttsResponses.length === 0 && Date.now() < deadline) await page.waitForTimeout(500);
    report('开启后仅新回复触发真实 TTS', ttsResponses.some((item) => item.status === 200 && item.hasAudioUrl), `responses=${ttsResponses.length}`);
    await page.getByRole('button', { name: '关闭 AI 回复语音播报', exact: true }).click();
    await page.screenshot({ path: `${OUT}/speech-guided-desktop.png`, fullPage: false });
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await injectAndGoto(mobile, authSession, `/student/training?session=${guidedId}`);
    const mobileSpeechRequests = observeSpeechRequests(mobilePage);
    mobilePage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    mobilePage.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    await checkDraftAndLayout(mobilePage, 'history', '窄屏问诊');
    const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report('390px 输入区无横向溢出', overflow <= 1, `delta=${overflow}px`);
    await mobilePage.waitForTimeout(500);
    report('窄屏历史会话不自动播报', mobileSpeechRequests.length === 0, `requests=${mobileSpeechRequests.length}`);
    await mobilePage.screenshot({ path: `${OUT}/speech-guided-mobile.png`, fullPage: false });
    await mobile.close();

    const practiceId = await createTrainingSession(authSession.access_token, { mode: 'practice', focus: 'communication' });
    const callContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const callPage = await injectAndGoto(callContext, authSession, `/student/training?session=${practiceId}`);
    const callSpeechRequests = observeSpeechRequests(callPage);
    callPage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    callPage.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    await checkDraftAndLayout(callPage, 'communication', '专项沟通');
    await callPage.waitForTimeout(500);
    report('专项沟通加载不主动调用语音接口', callSpeechRequests.length === 0, `requests=${callSpeechRequests.length}`);
    await callPage.screenshot({ path: `${OUT}/speech-practice-desktop.png`, fullPage: false });
    await callContext.close();

    report('浏览器 console/pageerror 无错误', consoleErrors.length === 0, `count=${consoleErrors.length}`);
  } catch (error) {
    report('语音与输入区浏览器流程', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  } finally {
    await browser.close();
  }
  const passed = results.filter((item) => item.ok).length;
  console.log(`SUMMARY ${passed}/${results.length} PASS`);
  console.log('NOTE | 真实麦克风 ASR 质量、扬声器音质和真机权限/听感未由本脚本验收');
  process.exit(passed === results.length ? 0 : 1);
}

void main();
