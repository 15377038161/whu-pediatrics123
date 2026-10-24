/**
 * 逐例 66 项实审证据包生成器：为单个病例装配全部实审输入到一份 Markdown 证据包，
 * 供逐例内容实审使用（每例落盘再下一例）。
 *
 * 装配内容：
 *  ① 候选全文（sections 五段 + demographics + vitals + documents 元信息）
 *  ② batch-audit 机械检查逐项结果（pass/flag + 证据）
 *  ③ cloud-compare 字段比对（demographics 一致性、五段云端/候选长度与重叠）
 *  ④ 云端快照元信息（版本/分片/媒体数；不可得则标注）
 *  ⑤ 交接方运行验证记录（routes；作为待核证据，不直接计通过）
 *  ⑥ 既有 standards.json 已审项（78 项部分实审的保留依据）
 *  ⑦ 媒体绑定叠加层（如有）
 *  ⑧ 形象路由 + 沟通档位（按候选 demographics 现算）
 *  ⑨ catalog/links 来源信息（别名/亚型映射）
 *
 * 用法：pnpm exec tsx scripts/case-audit/case-review-pack.mts <caseId>
 * 输出：outputs/case-library-review/20261024/review-packs/<caseId>.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { patientAppearance } from '@/domain/patient-appearance';
import { parseAgeToDays, resolveCommunicationProfile, toAgeBand } from '@/domain/communication-profile';
import { sourceExamDefinitions } from '@/domain/exam-methods';

const ROOT = process.cwd();
const DAY = 'outputs/case-library-review/20261024';
const PACK = 'outputs/local-handoff-20261023/pack-20261023';

const caseId = process.argv[2];
if (!caseId) { console.error('用法：pnpm exec tsx scripts/case-audit/case-review-pack.mts <caseId>'); process.exit(1); }

const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const out: string[] = [];
const H = (s: string) => out.push(`\n## ${s}\n`);

// ⑨ 来源信息
const link = TEACHER_CASE_LINKS[decodeURIComponent(caseId)];
const sourceId = link?.sourceId ?? decodeURIComponent(caseId);
const catalogEntry = TEACHER_CASE_CATALOG.find((c) => c.id === sourceId);
H('0. 来源与身份');
out.push(`- caseId：${caseId}`);
out.push(`- sourceId：${sourceId}${link ? `（经 TEACHER_CASE_LINKS 映射；映射类型 ${link.linkType ?? 'alias'}）` : '（直接来源）'}`);
out.push(`- catalog：${catalogEntry ? `folder=${catalogEntry.folder} name=${catalogEntry.name ?? ''}` : '无 catalog 条目'}`);

// ① 候选全文
const cand = readJson(path.join(ROOT, PACK, 'runtime-candidates', `${sourceId}.json`));
H('1. 候选全文（pack runtime-candidates）');
if (!cand) {
  out.push('**无候选**（3 例无映射条目之一，或别名未解析）——A01 维持无来源判定');
} else {
  out.push(`- demographics：age=${cand.age} sex=${cand.sex} complaint=${cand.complaint}`);
  out.push(`- vitals：${JSON.stringify(cand.vitals)}`);
  out.push(`- documents：${(cand.documents ?? []).length} 份（${(cand.documents ?? []).map((d: { source: string; sha256: string }) => `${d.source}:${d.sha256.slice(0, 8)}`).join('、')}）`);
  for (const k of ['history', 'exam', 'tests', 'diagnosis', 'plan'] as const) {
    const text = cand.sections?.[k] ?? '';
    out.push(`\n### 1.${k}（${text.length} 字）\n`);
    out.push('```');
    out.push(text.slice(0, 6000));
    if (text.length > 6000) out.push(`\n…（截断，全文 ${text.length} 字）`);
    out.push('```');
  }
}

// ② batch-audit 机械检查
const audit = readJson(path.join(ROOT, DAY, 'batch-audit', `${sourceId}.json`));
H('2. batch-audit 机械检查（pack 侧 18 项）');
if (!audit) {
  out.push('无 batch-audit 记录');
} else {
  const results = audit.results ?? audit;
  for (const [k, v] of Object.entries(results)) {
    const r = v as { status: string; evidence: string };
    if (r && typeof r === 'object' && 'status' in r) out.push(`- **${k}** ${r.status}：${r.evidence}`);
  }
}

// ③ cloud-compare
const cmp = readJson(path.join(ROOT, DAY, 'cloud-compare', `${sourceId}.json`));
H('3. cloud-compare 候选↔云端比对');
if (!cmp) {
  out.push('无比对记录');
} else if (!cmp.cloudAvailable) {
  out.push('**云端不可得**（KB 召回为空——R2-KB-01 标题缺失；召回相关项挂 not_verified，不阻断候选侧实审）');
} else {
  out.push(`- 云端元信息：v=${cmp.cloudMeta?.version?.slice(0, 12)} chunks=${cmp.cloudMeta?.chunkCount} media=${cmp.cloudMeta?.mediaCount}`);
  for (const [k, v] of Object.entries(cmp.fieldCmp ?? {})) {
    const f = v as { cloud: unknown; candidate: unknown; match?: boolean };
    if (f && typeof f === 'object' && 'match' in f) {
      out.push(`- ${k}：${f.match ? '一致' : `**不一致** cloud=${JSON.stringify(f.cloud)?.slice(0, 80)} cand=${JSON.stringify(f.candidate)?.slice(0, 80)}`}`);
    }
  }
  out.push('- 五段长度（cloud/candidate/行重叠）：');
  for (const [k, v] of Object.entries(cmp.sections ?? {})) {
    const s = v as { cloudLen: number; candLen: number; identical: boolean; lineOverlap: number };
    out.push(`  - ${k}：${s.cloudLen}/${s.candLen}/重叠${s.lineOverlap}${s.identical ? '（一致）' : ''}`);
  }
  out.push(`- candidateExtras：${JSON.stringify(cmp.candidateExtras)}；documents cloud/cand=${cmp.cloudDocuments}/${cmp.candidateDocuments}`);
}

// ④ 云端快照元信息
const snap = readJson(path.join(ROOT, DAY, 'cloud-snapshot', `${sourceId}.json`));
H('4. 云端快照元信息');
out.push(snap ? `- v=${snap.meta?.version?.slice(0, 12)} chunks=${snap.meta?.chunkCount} media=${snap.meta?.mediaCount} capturedAt=${snap.capturedAt}` : '无快照（云端不可得）');

// ⑤ 运行验证记录
const rv = readJson(path.join(ROOT, PACK, 'local-review-records', decodeURIComponent(caseId), 'runtime-verification-20261023.json'))
  ?? readJson(path.join(ROOT, PACK, 'local-review-records', sourceId, 'runtime-verification-20261023.json'));
H('5. 交接方运行验证记录（20261023，待核证据——记录存在不等于通过）');
if (!rv) {
  out.push('无记录');
} else {
  for (const r of rv.routes ?? []) {
    out.push(`- ${r.mode}${r.practiceFocus ? `/${r.practiceFocus}` : ''}：${r.result}（phase=${r.phase} source=${r.sourceAvailable} exam=${r.examCount} test=${r.testCount}）`);
  }
}

// ⑥ 既有已审项
const std = readJson(path.join(ROOT, PACK, 'local-review-records', decodeURIComponent(caseId), 'standards.json'))
  ?? readJson(path.join(ROOT, PACK, 'local-review-records', sourceId, 'standards.json'));
H('6. 既有 66 项状态（保留依据）');
if (!std) {
  out.push('无 standards.json');
} else {
  const done = (std.standards ?? []).filter((s: { status: string }) => s.status !== 'not_verified');
  out.push(`- 已审 ${done.length}/66；contentReady=${std.contentReady} medicalVerified=${std.medicalVerified} teacherTrialPublished=${std.teacherTrialPublished}`);
  for (const s of done) out.push(`  - **${s.id}** ${s.status}：${s.evidence}`);
}

// ⑦ 媒体绑定
const media = readJson(path.join(ROOT, DAY, 'media-bindings', `${sourceId}.testMedia.json`));
H('7. 媒体绑定叠加层');
out.push(media ? `- 已绑 ${media.testMedia.length} 组 / ${media.provenance.length} 张（${media.boundAt}；docx=${media.sourceDocxSha256.slice(0, 12)}…）` : '无绑定');

// ⑧ 形象与沟通档位
H('8. 形象路由与沟通档位（按候选 demographics 现算）');
if (cand) {
  const days = parseAgeToDays(String(cand.age));
  const band = toAgeBand(days);
  const app = patientAppearance(String(cand.sex), 'standing', decodeURIComponent(caseId), String(cand.age));
  const profile = resolveCommunicationProfile(decodeURIComponent(caseId), String(cand.age));
  out.push(`- age=${cand.age} → days=${days} band=${band}；sex=${cand.sex}`);
  out.push(`- 形象：key=${app.key} src=${app.src} alt=${app.alt}`);
  out.push(`- 沟通：speechCapability=${profile.speechCapability}（${profile.rationale ?? ''}）`);
  const exams = sourceExamDefinitions(cand.sections?.exam ?? '');
  const withContent = exams.filter((e) => (e[3] ?? '').trim().length > 0);
  out.push(`- 查体解析：${withContent.length}/18 项有内容（${withContent.map((e) => e[2]).join('、') || '无'}）`);
} else {
  out.push('无候选，跳过');
}

const outDir = path.join(ROOT, DAY, 'review-packs');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `${decodeURIComponent(caseId)}.md`), `# 66 项实审证据包：${decodeURIComponent(caseId)}\n生成：${new Date().toISOString()}\n${out.join('\n')}\n`);
console.log(`[review-pack] ${caseId}: cand=${cand ? 'ok' : '无'} audit=${audit ? 'ok' : '无'} cloud=${cmp ? (cmp.cloudAvailable ? 'ok' : '不可得') : '无'} rv=${rv ? (rv.routes ?? []).length : 0}路由 media=${media ? media.provenance.length : 0}`);
