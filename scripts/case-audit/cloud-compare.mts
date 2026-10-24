/**
 * 云端事实比对：KB 召回快照（ensureCaseSnapshot，运行时同路径）vs pack 候选 JSON
 *
 * 目的（README_FIRST 交接纪律）：
 *  - 逐例与云端事实比对：缺失者先作为私有候选接入；已存在者保留云端新增字段增量合并，
 *    不覆盖云端已有时点释放/媒体字段/修复和版本。
 *  - 本脚本只读比对、不写任何云端/数据库；ensureCaseSnapshot 无 accessToken 时跳过 DB 持久化。
 *
 * 用法：
 *  pnpm exec tsx outputs/local-handoff-20261023/audit/cloud-compare.mts [caseId]
 *  不带参数 = 全量 53 例；带参数 = 单例详细输出。
 *
 * 输出：outputs/case-library-review/20261024/cloud-compare/<caseId>.json + cloud-compare-ledger.md
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureCaseSnapshot, isKnowledgeConfigured } from '@/lib/case-snapshot';

const ROOT = process.cwd();
const PACK = path.join(ROOT, 'outputs/local-handoff-20261023/pack-20261023');
const CAND_DIR = path.join(PACK, 'runtime-candidates');
const OUT_DIR = path.join(ROOT, 'outputs/case-library-review/20261024/cloud-compare');
mkdirSync(OUT_DIR, { recursive: true });

const manifest = JSON.parse(readFileSync(path.join(PACK, 'manifest.json'), 'utf8'));
const onlyCase = process.argv[2];

/** 规范化（去空白/全半角差异）后比较；行级 Jaccard 重叠度作为相似度量。 */
function norm(s: string): string {
  return (s ?? '').replace(/\s+/g, '').replace(/[，。；：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}
function lineOverlap(a: string, b: string): number {
  const la = new Set(norm(a).split(/(?<=。)|\n/).filter((x) => x.length > 3));
  const lb = new Set(norm(b).split(/(?<=。)|\n/).filter((x) => x.length > 3));
  if (la.size === 0 && lb.size === 0) return 1;
  let inter = 0;
  for (const x of la) if (lb.has(x)) inter += 1;
  return inter / Math.max(la.size, lb.size);
}

interface SectionCmp { cloudLen: number; candLen: number; identical: boolean; lineOverlap: number }

async function compareOne(caseId: string) {
  const cand = JSON.parse(readFileSync(path.join(CAND_DIR, `${caseId}.json`), 'utf8'));
  const snap = await ensureCaseSnapshot(caseId);
  if (!snap) {
    return { caseId, cloudAvailable: false as const, note: 'KB 召回为空或失败（资料不足/来源守卫拒绝/网络）' };
  }
  const d = snap.data;
  const sections: Record<string, SectionCmp> = {};
  for (const key of ['history', 'exam', 'tests', 'diagnosis', 'plan'] as const) {
    const cloud = d.sections[key] ?? '';
    const local = cand.sections?.[key] ?? '';
    sections[key] = {
      cloudLen: cloud.length,
      candLen: local.length,
      identical: norm(cloud) === norm(local),
      lineOverlap: Number(lineOverlap(cloud, local).toFixed(3)),
    };
  }
  const fieldCmp = {
    age: { cloud: d.age, candidate: cand.age, match: norm(d.age) === norm(String(cand.age)) },
    sex: { cloud: d.sex, candidate: cand.sex, match: norm(d.sex) === norm(String(cand.sex)) },
    complaint: { cloud: d.complaint, candidate: cand.complaint, match: norm(d.complaint) === norm(String(cand.complaint)) },
    vitals: { cloud: d.vitals, candidate: cand.vitals },
  };
  // 候选 vs 云端增量：候选有 testRelease/testMedia/examMedia 时登记（合并时不得互相覆盖）
  const candidateExtras = {
    testRelease: Array.isArray(cand.testRelease) ? cand.testRelease.length : 0,
    testMedia: Array.isArray(cand.testMedia) ? cand.testMedia.length : 0,
    examMedia: Array.isArray(cand.examMedia) ? cand.examMedia.length : 0,
  };
  return {
    caseId,
    cloudAvailable: true as const,
    cloudMeta: { version: snap.meta.version, chunkCount: snap.meta.chunkCount, mediaCount: snap.meta.mediaCount, sourceKb: snap.meta.sourceKb, builtAt: snap.meta.builtAt },
    fieldCmp,
    sections,
    candidateExtras,
    cloudDocuments: Array.isArray((d as { documents?: unknown[] }).documents) ? (d as { documents: unknown[] }).documents.length : 0,
    candidateDocuments: (cand.documents ?? []).length,
  };
}

const results: unknown[] = [];
if (onlyCase) {
  const r = await compareOne(onlyCase);
  console.log(JSON.stringify(r, null, 2));
  results.push(r);
} else {
  const rows: string[] = [];
  let ok = 0; let unavailable = 0; let mismatches = 0;
  for (const entry of manifest.runtimeCandidates) {
    const caseId: string = entry.caseId;
    try {
      const r = await compareOne(caseId);
      results.push(r);
      writeFileSync(path.join(OUT_DIR, `${caseId}.json`), JSON.stringify(r, null, 2));
      if (!r.cloudAvailable) {
        unavailable += 1;
        rows.push(`| ${caseId} | 云端不可得 | — | — | — | — |`);
        console.log(`[cloud-compare] ${caseId}: 云端不可得`);
        continue;
      }
      ok += 1;
      const s = r.sections as Record<string, SectionCmp>;
      const identicalSections = Object.entries(s).filter(([, v]) => v.identical).map(([k]) => k);
      const lowOverlap = Object.entries(s).filter(([, v]) => !v.identical && v.lineOverlap < 0.6).map(([k]) => k);
      const fieldMismatch = Object.entries(r.fieldCmp as Record<string, { match?: boolean }>).filter(([, v]) => v.match === false).map(([k]) => k);
      if (lowOverlap.length || fieldMismatch.length) mismatches += 1;
      rows.push(`| ${caseId} | ✓ v=${(r.cloudMeta as { version: string }).version.slice(0, 8)} 片=${(r.cloudMeta as { chunkCount: number }).chunkCount} 媒=${(r.cloudMeta as { mediaCount: number }).mediaCount} | ${identicalSections.length}/5 段一致 | ${fieldMismatch.join('、') || '—'} | ${lowOverlap.join('、') || '—'} | ${Object.entries(s).map(([k, v]) => `${k}:${v.lineOverlap}`).join(' ')} |`);
      console.log(`[cloud-compare] ${caseId}: ok identical=${identicalSections.length}/5 fieldMismatch=[${fieldMismatch}] lowOverlap=[${lowOverlap}]`);
    } catch (error) {
      unavailable += 1;
      rows.push(`| ${caseId} | 比对异常 | ${(error as Error).message.slice(0, 60)} | — | — | — |`);
      console.warn(`[cloud-compare] ${caseId}: ERROR ${(error as Error).message}`);
    }
  }
  const ledger = `# 云端事实比对台账（KB 召回快照 vs pack 候选，2026-10-24）

- 口径：ensureCaseSnapshot（运行时同路径，可信来源标题精确匹配，失败关闭）；只读比对，不写云端/DB
- 汇总：53 例中云端可得 ${ok} / 不可得或异常 ${unavailable} / 存在字段或低重叠差异 ${mismatches}

| 病例 | 云端快照 | 段落一致 | 字段不一致 | 低重叠段(<0.6) | 各段行重叠 |
|------|----------|----------|------------|----------------|------------|
${rows.join('\n')}
`;
  writeFileSync(path.join(ROOT, 'outputs/case-library-review/20261024/cloud-compare-ledger.md'), ledger);
  console.log(`done: ok=${ok} unavailable=${unavailable} mismatched=${mismatches}`);
}
