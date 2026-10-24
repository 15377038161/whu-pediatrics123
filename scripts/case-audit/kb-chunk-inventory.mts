/**
 * KB 分片标题修复工单生成 v2（只读）：
 * 对 53 个有源病例 + 3 个无映射 catalog-only 条目，绕过可信标题过滤直查 KB，
 * 按【强归属证据】逐分片判定归属，产出教师可执行的标题补登工单。
 *
 * 强归属证据（判"待补登"的必要条件，防把其他患者事实注入本病例）：
 *   a) 分片内容含本病例 `病例ID：teacher-xxx` 头；或
 *   b) 分片含本病例名且含病例结构词（主诉/现病史/查体/辅助检查等）
 * 仅病名提及（病种清单、他病例鉴别诊断列表）判"提及非本体"，禁止补登。
 *
 * 薄证据自适应加深：前两组查询后 可信+强归属 仍 ≤1 的病例，
 * 追加两组专向查询（查体向/检验向）再判定。
 *
 * 输出（outputs/，Git 忽略）：
 *  - case-library-review/20261024/kb-chunk-inventory.json（机读全量清单）
 *  - case-library-review/20261024/kb-title-fix-workorder-20261024.md（教师工单）
 *
 * 用法：pnpm exec tsx scripts/case-audit/kb-chunk-inventory.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { KB_DOC_ID, trustedSourceTitles } from '@/lib/case-snapshot';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'outputs/case-library-review/20261024');
mkdirSync(OUT_DIR, { recursive: true });

// 已探针定案的 5 例完全空召回（cloud-snapshot 轮次）
const EMPTY_RECALL = new Set([
  'teacher-新生儿rh溶血性黄疸',
  'teacher-过敏性紫癜',
  'teacher-矮小症',
  'teacher-急性毛细支气管炎',
  'teacher-传染性单核细胞增多症',
]);

const CASE_STRUCT = /主诉|现病史|既往史|入院情况|查体|辅助检查|诊疗经过|出院诊断|出院情况/;
const CATALOG_LIST_TITLE = '儿科病例库--普通病种清单.xlsx';
const ID_RE = /teacher-[一-龥A-Za-z0-9-]+/g;

const client = new KnowledgeClient(new Config({
  apiKey: process.env.CODER_CODING_API_KEY!.trim(),
  baseUrl: process.env.CODER_CODING_BASE_URL!.trim(),
  timeout: 30_000,
}));

type ChunkKind = 'trusted' | 'self-strong' | 'mixed' | 'mention-only' | 'foreign-only' | 'titled-other' | 'no-trace' | 'catalog-list';
interface ChunkRec { title: string; kind: ChunkKind; foreignIds: string[]; snippet: string }
interface CaseInv {
  caseId: string; name: string; emptyRecall: boolean; deepened: boolean;
  counts: Record<ChunkKind, number>;
  chunks: ChunkRec[];
}

const KIND_LABEL: Record<ChunkKind, string> = {
  trusted: '可信',
  'self-strong': '待补登',
  mixed: '交叉疑点',
  'mention-only': '提及非本体',
  'foreign-only': '他例分片',
  'titled-other': '他例已命名',
  'no-trace': '无归属痕迹',
  'catalog-list': '病种清单',
};

async function queryChunks(caseId: string, name: string, queries: string[], byKey: Map<string, ChunkRec>): Promise<void> {
  const trusted = new Set(trustedSourceTitles(name));
  for (const query of queries) {
    try {
      const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
      for (const item of result.results) {
        const content = item.content ?? '';
        if (!content.trim()) continue;
        const key = content.slice(0, 80);
        if (byKey.has(key)) continue;
        const title = (item.title ?? '').trim();
        const ids = [...new Set([...content.matchAll(ID_RE)].map((m) => m[0]))];
        const selfId = ids.includes(caseId);
        const selfHit = content.includes(name);
        const hasStruct = CASE_STRUCT.test(content);
        const foreignIds = ids.filter((id) => id !== caseId);
        const strongSelf = selfId || (selfHit && hasStruct);
        let kind: ChunkKind;
        if (title === CATALOG_LIST_TITLE) kind = 'catalog-list';
        else if (trusted.has(title)) kind = 'trusted';
        else if (strongSelf && foreignIds.length > 0) kind = 'mixed';
        else if (strongSelf) kind = 'self-strong';
        else if (selfHit) kind = 'mention-only';
        else if (foreignIds.length > 0) kind = 'foreign-only';
        else if (title) kind = 'titled-other';
        else kind = 'no-trace';
        byKey.set(key, { title, kind, foreignIds, snippet: content.replace(/\s+/g, ' ').slice(0, 60) });
      }
    } catch (error) {
      console.log(`  [${name}] 查询异常: ${(error as Error).message.slice(0, 80)}`);
    }
  }
}

async function inventoryCase(caseId: string, name: string): Promise<CaseInv> {
  const byKey = new Map<string, ChunkRec>();
  await queryChunks(caseId, name, [name, `${name} 查体 辅助检查 辅检`], byKey);
  const strongSoFar = [...byKey.values()].filter((c) => c.kind === 'trusted' || c.kind === 'self-strong' || c.kind === 'mixed').length;
  let deepened = false;
  if (strongSoFar <= 1) {
    deepened = true;
    await queryChunks(caseId, name, [`${name} 查体 体温 心率 呼吸`, `${name} 血常规 检验 白细胞`], byKey);
  }
  const chunks = [...byKey.values()];
  const counts = Object.fromEntries(
    (['trusted', 'self-strong', 'mixed', 'mention-only', 'foreign-only', 'titled-other', 'no-trace', 'catalog-list'] as ChunkKind[])
      .map((k) => [k, chunks.filter((c) => c.kind === k).length]),
  ) as Record<ChunkKind, number>;
  return { caseId, name, emptyRecall: EMPTY_RECALL.has(caseId), deepened, counts, chunks };
}

const sources = TEACHER_CASE_CATALOG.filter((c) => c.folder !== null);
const unmapped = TEACHER_CASE_CATALOG.filter((c) => c.folder === null && !TEACHER_CASE_LINKS[c.id]);
const targets = [...sources, ...unmapped];

const BATCH = 12;

function emitOutputs(all: CaseInv[]): void {
  writeFileSync(path.join(OUT_DIR, 'kb-chunk-inventory.json'), JSON.stringify({
    generatedAt: '2026-10-24',
    kbDocId: KB_DOC_ID,
    scope: { sources: sources.length, unmapped: unmapped.map((c) => c.id) },
    cases: all,
  }, null, 2));

  const groups = {
    empty: all.filter((c) => c.emptyRecall),
    partial: all.filter((c) => !c.emptyRecall && sources.some((s) => s.id === c.caseId)),
    unmappedList: all.filter((c) => unmapped.some((u) => u.id === c.caseId)),
  };

  const lines: string[] = [];
  lines.push('# KB 分片标题修复工单（教师/平台执行，2026-10-24 v2 强归属证据版）');
  lines.push('');
  lines.push('## 操作纪律（必读）');
  lines.push('');
  lines.push('1. 只对标记 **待补登** 的分片补登标题 `{源名}.txt`；补登前打开分片确认内容属本病例（`病例ID` 头或病名+病例结构）');
  lines.push('2. **禁止批量改标题**：存在交叉归属分片与"仅提及病名"的他病例分片，误判会把其他患者事实拼入本病例——这正是可信标题失败关闭守卫要防的事故');
  lines.push('3. **交叉疑点**：一片内容出现多个病例 ID，人工判断主归属后再定标题；判不清保持无标题（守卫继续拒收，安全）');
  lines.push('4. **提及非本体**：病种清单、他病例鉴别诊断中提及本病名——不是本病例材料，**不要补登**');
  lines.push('5. 正文中段既无病例 ID 又无结构词的分片无法自动归属（本工单不列）；教师可在 KB 控制台按源文档逐份核对补齐');
  lines.push('6. 完成后告知 Agent：重跑 cloud-snapshot + cloud-audit 复验，预期 exam/tests 段恢复、228 flag 大幅收敛');
  lines.push('');

  lines.push('## 汇总');
  lines.push('');
  lines.push('| 病例 | 可信 | 待补登 | 交叉疑点 | 提及非本体 | 他例 | 无痕迹 | 加深 |');
  lines.push('|------|------|--------|----------|------------|------|--------|------|');
  for (const c of all) {
    const k = c.counts;
    lines.push(`| ${c.name} | ${k.trusted} | ${k['self-strong']} | ${k.mixed} | ${k['mention-only']} | ${k['foreign-only'] + k['titled-other']} | ${k['no-trace']} | ${c.deepened ? '是' : '—'} |`);
  }
  lines.push('');

  const renderChunks = (c: CaseInv): void => {
    for (const ch of c.chunks.filter((x) => x.kind !== 'trusted' && x.kind !== 'catalog-list')) {
      lines.push(`- [${KIND_LABEL[ch.kind]}] 现标题:${ch.title || '(空)'} | 片段:${ch.snippet}${ch.foreignIds.length ? ` | 他例ID:${ch.foreignIds.join(',')}` : ''}`);
    }
  };

  lines.push('## A 组：完全空召回（5 例，补登后首批复验）');
  lines.push('');
  for (const c of groups.empty) {
    lines.push(`### ${c.name}（${c.caseId}）→ 建议标题 \`${c.name}.txt\``);
    renderChunks(c);
    lines.push('');
  }

  lines.push('## B 组：部分召回（48 例，exam/tests 段缺失随补登恢复）');
  lines.push('');
  for (const c of groups.partial) {
    if (c.counts['self-strong'] === 0 && c.counts.mixed === 0) {
      lines.push(`- **${c.name}**：未发现可安全自动归属的待补登分片（可信 ${c.counts.trusted} 片${c.deepened ? '，已加深查询' : ''}）——若复验后 exam/tests 仍缺，请在 KB 控制台直接核对源文档`);
      continue;
    }
    lines.push(`### ${c.name}（${c.caseId}）→ 建议标题 \`${c.name}.txt\``);
    renderChunks(c);
    lines.push('');
  }

  lines.push('## C 组：无映射 catalog 条目（3 例，KB 材料有无判定）');
  lines.push('');
  for (const c of groups.unmappedList) {
    const hasMaterial = c.counts['self-strong'] > 0 || c.counts.mixed > 0;
    lines.push(`### ${c.name}（${c.caseId}）→ ${hasMaterial ? '**KB 有可归因材料**（补登标题并登记映射后可接入）' : '**KB 无病例材料** → 需教师补传来源文档'}`);
    renderChunks(c);
    lines.push('');
  }

  const crossPairs = new Map<string, string[]>();
  for (const c of all) {
    for (const ch of c.chunks) {
      if (ch.kind === 'mixed') {
        const key = [c.caseId, ...ch.foreignIds].sort().join(' ⇄ ');
        crossPairs.set(key, [...(crossPairs.get(key) ?? []), ch.snippet]);
      }
    }
  }
  lines.push('## D 组：交叉归属疑点对（补登前必须人工核对）');
  lines.push('');
  if (crossPairs.size === 0) {
    lines.push('（无）');
  } else {
    for (const [pair, snippets] of crossPairs) {
      lines.push(`- ${pair}（${snippets.length} 片）：${snippets[0].slice(0, 48)}…`);
    }
  }
  lines.push('');

  writeFileSync(path.join(OUT_DIR, 'kb-title-fix-workorder-20261024.md'), lines.join('\n'));
  const totalFix = all.reduce((s, c) => s + c.counts['self-strong'], 0);
  console.log(`inventory: kb-chunk-inventory.json（${all.length} 例）; workorder: kb-title-fix-workorder-20261024.md`);
  console.log(`交叉疑点对 ${crossPairs.size} 组；待补登分片合计 ${totalFix} 片；加深查询 ${all.filter((c) => c.deepened).length} 例`);
}

// ---------- 分批执行 / 合并 ----------
// 用法：pnpm exec tsx scripts/case-audit/kb-chunk-inventory.mts <start>   每批 12 例
//       pnpm exec tsx scripts/case-audit/kb-chunk-inventory.mts merge    合并各批并出工单
const arg = process.argv[2];

if (arg === 'merge') {
  const parts: CaseInv[] = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    const f = path.join(OUT_DIR, `kb-chunk-inventory-part-${i}.json`);
    parts.push(...(JSON.parse(readFileSync(f, 'utf8')) as CaseInv[]));
  }
  const all = targets
    .map((t) => parts.find((p) => p.caseId === t.id))
    .filter((c): c is CaseInv => Boolean(c));
  if (all.length !== targets.length) {
    console.error(`合并不完整：${all.length}/${targets.length}，缺批次`);
    process.exit(1);
  }
  emitOutputs(all);
} else {
  const start = Number(arg ?? 0);
  const end = Math.min(targets.length, start + BATCH);
  console.log(`批次 ${start}-${end}（共 ${targets.length} 例；有源 ${sources.length}，无映射 ${unmapped.length}）`);
  const batch: CaseInv[] = [];
  for (const item of targets.slice(start, end)) {
    const inv = await inventoryCase(item.id, item.name);
    batch.push(inv);
    const k = inv.counts;
    console.log(`[${inv.caseId}]${inv.deepened ? '(加深)' : ''} 可信 ${k.trusted} | 待补登 ${k['self-strong']} | 交叉 ${k.mixed} | 提及 ${k['mention-only']} | 他例 ${k['foreign-only'] + k['titled-other']} | 无痕迹 ${k['no-trace']}`);
  }
  writeFileSync(path.join(OUT_DIR, `kb-chunk-inventory-part-${start}.json`), JSON.stringify(batch, null, 2));
  console.log(`part-${start} 落盘 ${batch.length} 例`);
}
