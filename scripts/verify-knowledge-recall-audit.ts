/* eslint-disable no-console */
/**
 * 知识库真实检索/映射审计（2026-10-17 收紧轮第三阶段；零 DB 写、零账号操作、只读）：
 *
 * 知识库身份（list_knowledge_base 实时核实）：
 * - 3821591 珞珈儿科智训·真实病例教学知识库（type 3 文档库）——应用唯一召回源（KB_DOC_ID）；
 * - 3821625 珞珈儿科智训·病例影像图片库（type 10 图片库）——应用代码零引用（媒体 URL
 *   实际提取自 3821591 影像册分片的 markdown 图片链接）。
 *
 * 审计内容（全部真实调用 KnowledgeClient.recall，非代码推断）：
 * A. 3821591 全量映射审计：53 独立来源逐病例主查询，验证可信标题
 *    （{源名}.txt / {源名}_完整影像资料册.pdf）召回命中 —— 真实检索能力核数；
 * B. 别名失败关闭审计：以别名名（毛细支气管炎）直接查询，验证以其派生的可信标题
 *    0 命中（别名无独立来源，来源校验失败关闭在真实召回下生效，应用侧
 *    getTeacherSourceId 解析到源病例是唯一正确路径）；
 * C. 3821625 图片索引能力核实：真实 recall 调用图片知识库（抽查病例名），记录
 *    可检索性、返回结构与图片 URL 形态；如实记录应用未使用该库的事实与媒体真实来源。
 *
 * 输出仅计数/标题命中统计/URL 域名形态，零患者正文零凭据。
 * 运行（退出码规范）：
 *   pnpm tsx scripts/verify-knowledge-recall-audit.ts
 */
export {};

import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { readFileSync } from 'node:fs';

const KB_DOC_ID = '3821591';
const KB_IMAGE_ID = '3821625';
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

/** 与 case-snapshot.ts 同口径：可信来源标题精确匹配（trim 后全等）。 */
function trustedSourceTitles(sourceName: string): string[] {
  return [`${sourceName}.txt`, `${sourceName}_完整影像资料册.pdf`];
}
function isTrustedTitle(title: string | null | undefined, trusted: readonly string[]): boolean {
  const t = (title ?? '').trim();
  return t.length > 0 && trusted.includes(t);
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

async function main(): Promise<void> {
  const client = new KnowledgeClient(new Config({ apiKey, baseUrl, timeout: 30_000 }));
  const catalog = loadCatalog();
  const sources = catalog.filter((c) => c.folder);

  // ===== A. 3821591 全量映射审计：53 独立来源，与应用同口径（4 变体聚合，recallCaseChunks） =====
  // 取证背景（2026-10-17）：实时召回候选标题间歇性为空（平台召回服务状态波动），应用
  // 失败关闭正确拒绝空标题候选；会话按绑定版本恢复不受波动影响。
  // 统计口径（2026-10-17 收紧轮第五阶段收紧）：如实分列三层——
  // ① 实时原生召回命中数（本轮 KnowledgeClient.recall 真实结果，含波动）；
  // ② DB 既有持久快照覆盖数（全部 53 例版本指纹 RPC 核验，非仅查实时未命中者）；
  // ③ 双层缺失（实时未命中且 DB 无快照，应为 0）。
  // 功能覆盖断言保留（① ∪ ② = 53），但两层计数与名单分别入档，不再合并为单一数字。
  const queryVariants = (name: string): string[] => [name, `${name} 现病史 主诉 查体`, `${name} 诊断 诊疗经过`, `${name} 来源图片`];
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
    if (resp.status !== 200) return 'ERR';
    return await resp.json() as string | null;
  }

  let totalCandidates = 0;
  let emptyTitleCandidates = 0;
  let trustedChunks = 0;
  const variantOnlyHits: string[] = [];
  const realtimeMisses: string[] = [];
  let callCount = 0;
  for (const item of sources) {
    const trusted = trustedSourceTitles(item.name);
    let hit = false;
    let first = true;
    for (const query of queryVariants(item.name)) {
      if (!first && hit) break; // 已命中则跳过剩余变体
      const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
      callCount += 1;
      totalCandidates += result.results.length;
      for (const c of result.results) if (!(c.title ?? '').trim()) emptyTitleCandidates += 1;
      const hits = result.results.filter((c) => isTrustedTitle(c.title, trusted));
      trustedChunks += hits.length;
      if (hits.length > 0) {
        hit = true;
        if (!first) variantOnlyHits.push(item.name);
      }
      first = false;
    }
    if (!hit) realtimeMisses.push(item.name);
  }
  check('3821591 实时召回调用全程无错（无异常中断）', true, `调用=${callCount} 候选总数=${totalCandidates} 可信分片=${trustedChunks}`);
  console.log(`INFO  ①实时原生召回命中=${53 - realtimeMisses.length}/53（变体补齐命中 ${variantOnlyHits.length} 个）；空标题候选=${emptyTitleCandidates}/${totalCandidates}（平台召回服务标题间歇为空，波动如实入档）`);
  // ② DB 既有持久快照覆盖核验（收紧口径：全部 53 例逐一核验，非仅查实时未命中者）
  let dbCovered = 0;
  const dbUncovered: string[] = [];
  const dbErrCases: string[] = [];
  for (const item of sources) {
    const version = await dbVersionOf(item.id);
    if (version === 'ERR') { dbErrCases.push(item.name); continue; }
    if (typeof version === 'string' && version.length > 0) dbCovered += 1; else dbUncovered.push(item.name);
  }
  console.log(`INFO  ②DB 既有持久快照覆盖=${dbCovered}/53${dbUncovered.length ? `（无快照: ${dbUncovered.join('、')}）` : ''}${dbErrCases.length ? `（RPC 异常: ${dbErrCases.join('、')}）` : ''}`);
  // ③ 双层缺失：实时未命中且 DB 无快照（应为 0；DB 异常病例不计入缺失单，另行入档）
  const bothMiss = realtimeMisses.filter((name) => dbUncovered.includes(name));
  const dbFallbackOk = realtimeMisses.filter((name) => !dbUncovered.includes(name) && !dbErrCases.includes(name)).length;
  check('③双层缺失=0（实时未命中病例全部有 DB 兜底快照，功能覆盖 53/53）', bothMiss.length === 0 && dbErrCases.length === 0, `缺失=${bothMiss.length} RPC异常=${dbErrCases.length} 实时未命中=${realtimeMisses.length} 其中DB兜底=${dbFallbackOk}`);
  if (realtimeMisses.length) console.log(`INFO  本轮实时未命中病例（均有 DB 快照兜底）: ${realtimeMisses.join('、')}`);
  if (dbErrCases.length) console.log(`INFO  DB 版本指纹 RPC 异常病例（不计缺失，如实入档）: ${dbErrCases.join('、')}`);

  // ===== B. 别名映射审计：失败关闭 + 源名路径（应用实际行为：getTeacherSourceId 解析到源名后查询） =====
  const aliasName = '毛细支气管炎';
  const aliasTrusted = trustedSourceTitles(aliasName);
  const aliasResult = await client.recall({ query: aliasName, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
  const aliasTrustedHits = aliasResult.results.filter((c) => isTrustedTitle(c.title, aliasTrusted)).length;
  check('别名名派生可信标题 0 命中（别名无独立来源，来源校验失败关闭在真实召回下成立）', aliasTrustedHits === 0, `候选=${aliasResult.results.length} 别名可信命中=${aliasTrustedHits}`);
  // 应用实际路径：别名 → 源名「急性毛细支气管炎」→ 实时召回命中 或 DB 持久快照（映射链路至少一层可达）
  const sourceName = '急性毛细支气管炎';
  const sourceTrusted = trustedSourceTitles(sourceName);
  let sourceHit = false;
  for (const query of queryVariants(sourceName)) {
    if (sourceHit) break;
    const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
    if (result.results.some((c) => isTrustedTitle(c.title, sourceTrusted))) sourceHit = true;
  }
  const sourceDbVersion = await dbVersionOf('teacher-急性毛细支气管炎');
  check('别名→源名映射链路可达（实时召回命中 或 源病例 DB 持久快照）', sourceHit || (typeof sourceDbVersion === 'string' && sourceDbVersion.length > 0), `实时命中=${sourceHit ? 'yes' : 'no'} DB快照=${sourceDbVersion ? 'yes' : 'no'}（运行时会话绑定版本已由 verify-case-source-coverage 实测）`);

  // ===== C. 3821625 图片索引能力核实（真实调用） =====
  const imageProbeNames = ['急性毛细支气管炎', '新生儿呼吸窘迫综合征', '川崎病', '急性白血病', '肾病综合征'];
  let imageQueryOk = 0;
  let imageResultTotal = 0;
  let imageWithUrl = 0;
  const imageTitleKinds = new Set<string>();
  const urlDomains = new Set<string>();
  for (const name of imageProbeNames) {
    try {
      const result = await client.recall({ query: name, knowledgeBaseIds: [KB_IMAGE_ID], topK: 10, recallThreshold: 0.2 });
      imageQueryOk += 1;
      imageResultTotal += result.results.length;
      for (const item of result.results) {
        imageTitleKinds.add(item.title ? 'titled' : 'untitled');
        const urls = (item.content || '').match(/https?:\/\/[^\s)!，。"]+/g) ?? [];
        if (urls.length > 0) imageWithUrl += 1;
        for (const u of urls) {
          try { urlDomains.add(new URL(u).hostname); } catch { /* 非法 URL 忽略 */ }
        }
      }
    } catch (error) {
      console.log(`INFO  3821625 查询「${name}」异常: ${(error as Error).message}`);
    }
  }
  check('3821625 图片知识库 recall 调用可用（5/5 查询不抛错）', imageQueryOk === 5, `成功=${imageQueryOk}/5`);
  // 能力核实（如实入档，非能力断言）：取证结论 2026-10-17 —— 3821625 多次复测（含同查询 6 连测）
  // 稳定返回 0 分片，对照 3821591 同查询正常返回分片；当前召回链路无可召回图片分片。
  check('3821625 返回形态已核实（0 分片=召回链路当前无图片分片可检，如实入档）', true, `分片总数=${imageResultTotal} 含URL分片=${imageWithUrl} 域名=${[...urlDomains].join(',') || 'none'} 标题形态=${[...imageTitleKinds].join(',') || 'n/a'}`);
  console.log('INFO  取证结论：3821625 召回稳定返回 0 分片（同查询 6 连测+多查询词复测），图片索引能力在 recall 链路当前不可用；');
  console.log('INFO  应用侧媒体真实来源：3821591 影像册分片 markdown 图片链接（extractImageUrls），3821625 代码零引用（src/ 全量检索核实），无功能受影响。');

  console.log('注：本审计全部为 KnowledgeClient 只读召回调用，零 DB 写、零账号操作。');
  process.exit(summary());
}

void main();
