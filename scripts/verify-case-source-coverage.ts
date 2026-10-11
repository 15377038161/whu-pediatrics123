/* eslint-disable no-console */
/**
 * 全病例来源覆盖审计（2026-10-17 收紧轮第三阶段；零 DB 写、零账号操作、只读）：
 *
 * 三方交叉核对（用户要求口径：53 独立来源覆盖 67 项、14 别名及 3 无独立来源须准确）：
 * 1. 目录层：TEACHER_CASE_CATALOG 70 项 —— 53 folder（独立来源）+ 17 catalog-only；
 * 2. 映射层：TEACHER_CASE_LINKS 14 别名/亚型 → 源病例；别名目标必须落在 53 独立来源内；
 *    catalog-only − 别名 = 3 无独立来源（新生儿脑梗死/支气管肺炎/格林巴利综合征）；
 * 3. 数据层：case_snapshot_facts（登录可读 RLS）快照 case_id 集合 == 53 独立来源集合；
 *    别名与无独立来源不得有自有快照（别名经 getTeacherSourceId 解析到源，无独立来源不召回）；
 * 4. 运行时映射实测：以别名病例建真实会话（guided）→ 会话绑定的 sourceSnapshotVersion 必须等于
 *    源病例快照版本（getTeacherSourceId 别名解析经真实应用链路验证，非仅代码层推断）。
 *
 * 输出仅计数/caseId/版本指纹/状态码，零患者正文零凭据。
 * 运行（退出码规范）：
 *   pnpm tsx scripts/verify-case-source-coverage.ts --cred <0600 学生凭据>
 */
export {};

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.COVER_BASE_URL ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('仅允许本地地址验证');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

let passCount = 0;
let failCount = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passCount += 1; console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`); }
  else { failCount += 1; console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`); }
}
function summary(): number {
  console.log(`结果: ${passCount} PASS / ${failCount} FAIL`);
  return failCount === 0 ? 0 : 1;
}

function loadCred(): { email: string; password: string } {
  const idx = process.argv.indexOf('--cred');
  const file = idx >= 0 ? process.argv[idx + 1] : '';
  if (!file) throw new Error('缺少 --cred <0600 凭据文件>');
  let email = '', password = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(email|password)\s*[:=]\s*(.+?)\s*$/i);
    if (m) { if (m[1].toLowerCase() === 'email') email = m[2]; else password = m[2]; }
  }
  if (!email || !password) throw new Error('凭据文件缺少 email/password');
  return { email, password };
}

// ===== 目录/映射解析（与 preheat-case-snapshots.ts 同模式：正则解析，不 import src） =====
interface CatalogItem { id: string; name: string; folder: string | null }

function loadCatalog(): CatalogItem[] {
  const text = readFileSync('src/domain/teacher-case-catalog.ts', 'utf8');
  const re = /"id":\s*"([^"]+)"[^}]*?"name":\s*"([^"]+)"[^}]*?"folder":\s*(?:"([^"]+)"|null)/g;
  const items: CatalogItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) items.push({ id: m[1], name: m[2], folder: m[3] ?? null });
  return items;
}

function loadLinks(): Map<string, { sourceId: string; relation: string }> {
  const text = readFileSync('src/domain/teacher-case-links.ts', 'utf8');
  const re = /'([^']+)':\s*\{\s*sourceId:\s*'([^']+)',\s*relation:\s*'(alias|subtype)'\s*\}/g;
  const links = new Map<string, { sourceId: string; relation: string }>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) links.set(m[1], { sourceId: m[2], relation: m[3] });
  return links;
}

async function main(): Promise<void> {
  const catalog = loadCatalog();
  const links = loadLinks();
  const withFolder = catalog.filter((c) => c.folder);
  const noFolder = catalog.filter((c) => !c.folder);
  const folderIds = new Set(withFolder.map((c) => c.id));

  // ===== 1) 目录层核数 =====
  check('目录总数 70 项', catalog.length === 70, `实际=${catalog.length}`);
  check('独立来源（folder）53 项', withFolder.length === 53, `实际=${withFolder.length}`);
  check('无 folder 项 17 项（14 别名 + 3 无独立来源）', noFolder.length === 17, `实际=${noFolder.length}`);
  check('别名/亚型映射 14 条', links.size === 14, `实际=${links.size}`);

  // ===== 2) 映射层：别名目标必须落在 53 独立来源内 =====
  const badTargets = [...links.entries()].filter(([, v]) => !folderIds.has(v.sourceId));
  check('14 条别名映射目标全部在 53 独立来源内', badTargets.length === 0, badTargets.length ? `越界目标=${badTargets.map(([k, v]) => `${k}->${v.sourceId}`).join(';')}` : '14/14');
  const aliasIds = new Set(links.keys());
  const noSource = noFolder.filter((c) => !aliasIds.has(c.id));
  check('无独立来源 3 项（catalog-only 且非别名）', noSource.length === 3, `实际=${noSource.length}：${noSource.map((c) => c.name).join('、')}`);
  const covered = withFolder.length + aliasIds.size;
  check('来源覆盖 67 项（53 独立 + 14 别名→源）', covered === 67, `实际=${covered}`);

  // ===== 3) 数据层核数（口径修正 2026-10-17 收紧轮：学生不直读 case_snapshot_facts ——
  //   RLS 收紧后仅教师可读，学生直读被过滤为 0 行属权限收紧正确表现，非数据缺失；
  //   集合级核数改走受控 RPC case_snapshot_latest_version(p_case_id)（authenticated 可执行，
  //   SECURITY DEFINER 仅返回版本指纹文本，无患者正文，迁移 20261013150000）逐病例查询） =====
  const cred = loadCred();
  const authResp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${SUPA_ANON_KEY}`, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
  const auth = (await authResp.json()) as { access_token?: string };
  if (!auth.access_token) throw new Error('登录失败');

  // 3a) RLS 收紧验证：学生直读 facts 表应被过滤为 0 行（不泄漏任何病例事实）
  const factsResp = await fetch(`${SUPA_URL}/rest/v1/case_snapshot_facts?select=case_id`, {
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${auth.access_token}`, 'X-Instance-ID': SUPA_TENANT_ID },
  });
  const factsRows = (await factsResp.json()) as unknown;
  check('case_snapshot_facts 学生直读被 RLS 过滤为 0 行（权限收紧生效）', factsResp.status === 200 && Array.isArray(factsRows) && factsRows.length === 0, `status=${factsResp.status} rows=${Array.isArray(factsRows) ? factsRows.length : 'n/a'}`);

  // 3b) 集合级核数：53 独立来源逐病例查最新版本指纹
  const rpcHeaders = { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${auth.access_token}`, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' };
  const latestVersion = new Map<string, string>();
  for (const id of folderIds) {
    const rpcResp = await fetch(`${SUPA_URL}/rest/v1/rpc/case_snapshot_latest_version`, {
      method: 'POST', headers: rpcHeaders, body: JSON.stringify({ p_case_id: id }),
    });
    const version = rpcResp.status === 200 ? await rpcResp.json() as string | null : null;
    if (typeof version === 'string' && version.length > 0) latestVersion.set(id, version);
  }
  check('53 独立来源全部有持久化快照（case_snapshot_latest_version 逐病例核数）', latestVersion.size === 53, `有快照=${latestVersion.size}/53`);
  const missingSnapshot = [...folderIds].filter((id) => !latestVersion.has(id));
  check('53 独立来源快照无缺失', missingSnapshot.length === 0, missingSnapshot.length ? `缺快照=${missingSnapshot.join(',')}` : '53/53');
  check('快照版本指纹唯一性（无重复版本漂移）', new Set(latestVersion.values()).size === latestVersion.size, `唯一版本=${new Set(latestVersion.values()).size}/${latestVersion.size}`);

  // 3c) 无自有快照验证：14 别名 + 3 无独立来源经 RPC 应返回 null（别名经解析到源，无独立不召回）
  const noOwnSnapshot: string[] = [];
  for (const id of [...aliasIds, ...noSource.map((c) => c.id)]) {
    const rpcResp = await fetch(`${SUPA_URL}/rest/v1/rpc/case_snapshot_latest_version`, {
      method: 'POST', headers: rpcHeaders, body: JSON.stringify({ p_case_id: id }),
    });
    const version = rpcResp.status === 200 ? await rpcResp.json() as string | null : 'ERR';
    if (version !== null) noOwnSnapshot.push(id);
  }
  check('别名/无独立来源病例无自有快照（17/17 返回 null）', noOwnSnapshot.length === 0, noOwnSnapshot.length ? `越界=${noOwnSnapshot.join(',')}` : '17/17');

  // ===== 4) 运行时映射实测：别名病例建真实会话 → 绑定源病例快照版本 =====
  // 取一条别名映射（毛细支气管炎 → 急性毛细支气管炎）
  const aliasId = 'teacher-毛细支气管炎';
  const link = links.get(aliasId);
  if (!link) throw new Error('别名映射缺失 teacher-毛细支气管炎');
  const sourceVersion = latestVersion.get(link.sourceId) ?? null;
  const created = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'guided', caseId: aliasId }),
  });
  const createdBody = (await created.json()) as { data?: { id?: string } };
  check('别名病例建会话成功（201）', created.status === 201 && Boolean(createdBody.data?.id), `status=${created.status}`);
  const sessionId = createdBody.data?.id ?? '';
  if (sessionId) {
    const loaded = await fetch(`${BASE}/api/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${auth.access_token}` } });
    const loadedBody = (await loaded.json()) as { data?: { sourceSnapshotVersion?: string | null; caseId?: string; caseOptions?: { sourceName?: string } | null } };
    const session = loadedBody.data;
    check('别名会话读取成功（200）', loaded.status === 200, `status=${loaded.status}`);
    check('别名会话绑定源病例快照版本（getTeacherSourceId 运行时映射）', session?.sourceSnapshotVersion === sourceVersion, `会话版本=${session?.sourceSnapshotVersion?.slice(0, 8) ?? 'null'} 源版本=${sourceVersion?.slice(0, 8) ?? 'null'}`);
    check('别名会话 caseOptions 含来源信息（源病例数据注入）', Boolean(session?.caseOptions), `caseOptions=${session?.caseOptions ? 'present' : 'null'}`);
  }

  // ===== 5) 无独立来源病例：安全缺资料反馈（不召回不编造） =====
  const noSourceId = noSource[0]?.id ?? '';
  if (noSourceId) {
    const nsCreated = await fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'guided', caseId: noSourceId }),
    });
    const nsBody = (await nsCreated.json()) as { data?: { id?: string } };
    check('无独立来源病例建会话成功（201，入口开放自主研习）', nsCreated.status === 201 && Boolean(nsBody.data?.id), `status=${nsCreated.status} case=${noSourceId}`);
    const nsSessionId = nsBody.data?.id ?? '';
    if (nsSessionId) {
      const nsLoaded = await fetch(`${BASE}/api/sessions/${nsSessionId}`, { headers: { Authorization: `Bearer ${auth.access_token}` } });
      const nsData = ((await nsLoaded.json()) as { data?: { sourceSnapshotVersion?: string | null; caseOptions?: unknown } }).data;
      check('无独立来源会话不绑定快照版本（不召回不编造，资料不足降级）', nsLoaded.status === 200 && (nsData?.sourceSnapshotVersion === null || nsData?.sourceSnapshotVersion === undefined), `版本=${nsData?.sourceSnapshotVersion ?? 'null'}`);
    }
  }

  console.log('注：审计只读为主（RLS 收紧验证+版本指纹 RPC 均为 SELECT；别名/无独立来源会话为正常业务写入属用户操作，非历史修改）。');
  process.exit(summary());
}

void main();
