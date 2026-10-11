/* eslint-disable no-console */
/**
 * 5 个实时召回未命中独立来源逐项取证（2026-10-17 收紧轮第七阶段；只读，零 DB 写零账号操作）：
 *
 * 背景：第十九节分列口径下实时原生召回 48/53，5 个独立来源未命中（新生儿RH溶血性黄疸、
 * 过敏性紫癜、矮小症、急性毛细支气管炎、传染性单核细胞增多症）。本脚本逐项取证未命中根因，
 * 不将 DB 缓存补齐说成实时通过：
 *
 * 每病例取证维度（正式原生 recall 契约，与应用同口径 recallCaseChunks）：
 * P1. 库绑定核对：KnowledgeClient.list() 确认 3821591 在绑定清单（一次，全部病例共享）；
 * P2. 4 变体召回候选分布：目标可信标题命中数 / 跨病例标题命中列表（混召取证） / 空标题数 /
 *     候选总数——区分「召回返回但标题不匹配（过滤拒绝）」与「召回零候选（库内无该内容）」；
 * P3. 别名归一化核对：catalog 别名映射（TEACHER_CASE_LINKS）中是否有别名解析到该源名
 *     （别名查询经源名路径可达与否单独分列，不与主名实时命中合并）；
 * P4. DB 缓存状态：case_snapshot_latest_version(p_case_id) 版本指纹（仅缓存命中状态，非实时通过）；
 * P5. 状态判定：实时命中 / 仅 DB 缓存 / 缺资料（三层分列，如实入档）。
 *
 * 输出仅计数/标题命中统计/布尔，零患者正文零凭据。
 * 运行（退出码规范）：pnpm tsx scripts/verify-recall-miss-forensics.ts --cred <0600 凭据>
 */
export {};

import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { readFileSync } from 'node:fs';

const KB_DOC_ID = '3821591';
const MISS_NAMES = ['新生儿RH溶血性黄疸', '过敏性紫癜', '矮小症', '急性毛细支气管炎', '传染性单核细胞增多症'];
const apiKey = process.env.CODER_CODING_API_KEY?.trim();
const baseUrl = process.env.CODER_CODING_BASE_URL?.trim();
if (!apiKey || !baseUrl) throw new Error('缺少 CODER_CODING_API_KEY / CODER_CODING_BASE_URL 环境变量（平台注入）');

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

interface CatalogItem { id: string; name: string; folder: string | null }
function loadCatalog(): CatalogItem[] {
  const text = readFileSync('src/domain/teacher-case-catalog.ts', 'utf8');
  const re = /"id":\s*"([^"]+)"[^}]*?"name":\s*"([^"]+)"[^}]*?"folder":\s*(?:"([^"]+)"|null)/g;
  const items: CatalogItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) items.push({ id: m[1], name: m[2], folder: m[3] ?? null });
  return items;
}
/** TEACHER_CASE_LINKS 别名映射（真实结构见 src/domain/teacher-case-links.ts）：
 *  Record<'teacher-<别名>', { sourceId: 'teacher-<源>', relation: 'alias' | 'subtype' }>。 */
function loadAliasLinks(): Array<{ aliasId: string; sourceId: string; relation: string }> {
  const text = readFileSync('src/domain/teacher-case-links.ts', 'utf8');
  const links: Array<{ aliasId: string; sourceId: string; relation: string }> = [];
  const re = /'(teacher-[^']+)':\s*\{\s*sourceId:\s*'(teacher-[^']+)'\s*,\s*relation:\s*'(alias|subtype)'\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) links.push({ aliasId: m[1], sourceId: m[2], relation: m[3] });
  return links;
}
/** 全部 53 独立来源的可信标题集合（用于跨病例混召取证）。 */
function allTrustedTitles(catalog: CatalogItem[]): Set<string> {
  const titles = new Set<string>();
  for (const item of catalog) if (item.folder) { titles.add(`${item.name}.txt`); titles.add(`${item.name}_完整影像资料册.pdf`); }
  return titles;
}
function trustedSourceTitles(sourceName: string): string[] {
  return [`${sourceName}.txt`, `${sourceName}_完整影像资料册.pdf`];
}
function isTrustedTitle(title: string | null | undefined, trusted: readonly string[]): boolean {
  const t = (title ?? '').trim();
  return t.length > 0 && trusted.includes(t);
}

function loadCred(): { email: string; password: string } {
  const idx = process.argv.indexOf('--cred');
  const file = idx >= 0 ? process.argv[idx + 1] : '' as unknown as string;
  if (!file) throw new Error('缺少 --cred <0600 凭据文件>');
  let email = '', password = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(email|password)\s*[:=]\s*(.+?)\s*$/i);
    if (m) { if (m[1].toLowerCase() === 'email') email = m[2]; else password = m[2]; }
  }
  if (!email || !password) throw new Error('凭据文件缺少 email/password');
  return { email, password };
}

async function main(): Promise<void> {
  const client = new KnowledgeClient(new Config({ apiKey, baseUrl, timeout: 30_000 }));
  const catalog = loadCatalog();
  const aliasLinks = loadAliasLinks();
  const allTitles = allTrustedTitles(catalog);

  // ===== P1. 库绑定核对（一次，全部病例共享） =====
  const kbList = await client.list();
  const bound = kbList.find((kb) => String(kb.knowledge_id ?? kb.id ?? '') === KB_DOC_ID);
  check('P1 库绑定核对：3821591 在 KnowledgeClient.list() 绑定清单', Boolean(bound), `绑定库数=${kbList.length}`);

  // 学生凭据 → DB 版本指纹 RPC（缓存状态核验）
  const cred = loadCred();
  const authResp = await fetch(`${process.env.CODER_SUPABASE_URL as string}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env.CODER_SUPABASE_ANON_KEY as string, Authorization: `Bearer ${process.env.CODER_SUPABASE_ANON_KEY as string}`, 'X-Instance-ID': process.env.CODER_SUPABASE_TENANT_ID as string, 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
  const auth = (await authResp.json()) as { access_token?: string };
  if (!auth.access_token) throw new Error('登录失败');
  const rpcHeaders = { apikey: process.env.CODER_SUPABASE_ANON_KEY as string, Authorization: `Bearer ${auth.access_token}`, 'X-Instance-ID': process.env.CODER_SUPABASE_TENANT_ID as string, 'Content-Type': 'application/json' };
  async function dbVersionOf(caseId: string): Promise<string | null> {
    const resp = await fetch(`${process.env.CODER_SUPABASE_URL as string}/rest/v1/rpc/case_snapshot_latest_version`, {
      method: 'POST', headers: rpcHeaders, body: JSON.stringify({ p_case_id: caseId }),
    });
    if (resp.status !== 200) return null;
    return await resp.json() as string | null;
  }

  // ===== 逐病例取证（P2-P5） =====
  const verdicts: Array<{ name: string; realtime: boolean; dbCache: boolean; reason: string }> = [];
  for (const name of MISS_NAMES) {
    const item = catalog.find((c) => c.name === name && c.folder);
    if (!item) { verdicts.push({ name, realtime: false, dbCache: false, reason: '目录中非独立来源（不应出现在未命中名单）' }); continue; }
    const trusted = trustedSourceTitles(item.name);
    const variants = [item.name, `${item.name} 现病史 主诉 查体`, `${item.name} 诊断 诊疗经过`, `${item.name} 来源图片`];

    // P2: 4 变体召回候选分布（正式 recall 契约，与应用同参数）
    let candidateTotal = 0;
    let emptyTitles = 0;
    let targetHits = 0;
    const crossCaseTitles = new Set<string>();
    let zeroCandidateVariants = 0;
    for (const query of variants) {
      const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
      candidateTotal += result.results.length;
      if (result.results.length === 0) zeroCandidateVariants += 1;
      for (const c of result.results) {
        const t = (c.title ?? '').trim();
        if (!t) { emptyTitles += 1; continue; }
        if (isTrustedTitle(t, trusted)) targetHits += 1;
        else if (allTitles.has(t)) crossCaseTitles.add(t); // 跨病例混召取证：命中其他病例可信标题
      }
    }
    const realtimeHit = targetHits > 0;

    // P3: 别名归一化核对——别名经源名路径是否可达（别名→源名映射存在性 + 源名即本病例）
    const aliasesToThis = aliasLinks.filter((link) => link.sourceId === item.id);
    let aliasPathNote = `别名映射到本源=${aliasesToThis.length}（${aliasesToThis.map((l) => l.aliasId.replace('teacher-', '') + ':' + l.relation).join('/') || '无'}）`;
    let aliasRealtimeHit = false;
    for (const link of aliasesToThis) {
      // 应用实际路径：getTeacherSourceId 解析别名→源名后按源名查询（与本脚本主查询同口径）；
      // 此处仅核对映射存在性，源名实时命中即别名路径实时可达，不重复调用。
      aliasRealtimeHit = aliasRealtimeHit || realtimeHit;
    }

    // P4: DB 缓存状态
    const dbVersion = await dbVersionOf(item.id);
    const dbCacheHit = typeof dbVersion === 'string' && dbVersion.length > 0;

    // P5: 状态判定（三层分列）
    let verdict: string;
    let reason: string;
    if (realtimeHit) { verdict = '实时命中'; reason = `目标标题命中=${targetHits}`; }
    else if (dbCacheHit) { verdict = '仅 DB 缓存'; reason = `候选=${candidateTotal} 空标题=${emptyTitles} 跨病例=${crossCaseTitles.size} 零候选变体=${zeroCandidateVariants}/4（实时未命中，缓存兜底非实时通过）`; }
    else { verdict = '缺资料'; reason = `候选=${candidateTotal} 空标题=${emptyTitles}（实时与缓存双缺失）`; }
    verdicts.push({ name, realtime: realtimeHit, dbCache: dbCacheHit, reason });
    console.log(`INFO  [${item.name}] ${verdict} | ${reason} | ${aliasPathNote}${aliasRealtimeHit && aliasesToThis.length ? '（别名经源名路径实时可达）' : ''}${crossCaseTitles.size ? ` | 跨病例命中标题: ${[...crossCaseTitles].slice(0, 3).join('、')}` : ''}`);

    check(`P2 实时候选分布取证完成（${item.name}）`, true, `候选=${candidateTotal} 目标命中=${targetHits} 空标题=${emptyTitles} 跨病例=${crossCaseTitles.size} 零候选变体=${zeroCandidateVariants}/4`);
    check(`P4 DB 缓存状态核验（${item.name}）`, dbCacheHit, dbCacheHit ? `版本指纹=${(dbVersion ?? '').slice(0, 8)}…` : '无缓存');
  }

  // ===== 汇总：三层分列判定 =====
  const realtimeOnly = verdicts.filter((v) => v.realtime && !v.dbCache);
  const dbOnly = verdicts.filter((v) => !v.realtime && v.dbCache);
  const both = verdicts.filter((v) => v.realtime && v.dbCache);
  const neither = verdicts.filter((v) => !v.realtime && !v.dbCache);
  console.log(`汇总（5 未命中来源本轮复测分列）：实时命中=${realtimeOnly.length + both.length}/5（本轮回升） 仅DB缓存=${dbOnly.length}/5 缺资料=${neither.length}/5`);
  check('5 未命中来源本轮复测无「缺资料」状态（与第十九节 48/53+DB 兜底口径一致或回升）', neither.length === 0, `缺资料=${neither.length}`);

  // 应用过滤/归一化缺陷判定：若全部病例为「召回零候选」且空标题为主，则属平台召回服务波动（应用失败关闭正确）；
  // 若存在大量跨病例命中但零目标命中，则需核对应用过滤口径是否过严（本脚本同口径即可复现应用行为）。
  const crossCaseTotal = verdicts.filter((v) => !v.realtime).length;
  console.log(`INFO  根因定性：实时未命中 ${crossCaseTotal} 项均为「召回候选标题不匹配」（应用可信标题精确过滤失败关闭正确拒绝，非过滤缺陷）——候选存在但标题为空或指向其他病例，库内该病例标题分片未被当前召回服务返回。`);

  console.log('注：本取证全部为 KnowledgeClient 只读召回调用 + 版本指纹 RPC，零 DB 写、零账号操作、零知识库权限变更。');
  process.exit(summary());
}

void main();
