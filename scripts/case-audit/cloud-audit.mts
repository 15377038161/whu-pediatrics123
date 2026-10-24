/**
 * 云端现状机械审计（真实链路核验第一轮）：
 * 对 outputs/case-library-review/20261024/cloud-snapshot/*.json（48 例已固化 KB 召回快照）
 * 跑与 batch-audit 同一套 18 项机械检查——云端（KB 召回）是生产环境学生真实获得的事实集，
 * 云端审计独立于 pack 候选比对，可与 pack 侧审计结果交叉印证（两侧提取代码不同）。
 *
 * 与 batch-audit 的差异：
 *  - A01 改为快照版本指纹 + caseId 一致性（无 manifest 可核）
 *  - A04/L01 记 not_verified（交接方运行验证记录随 pack 丢失，待重传后补）
 *  - F04：SnapshotCaseData 无 testRelease 字段 → 一律记"未接入（待全量合并）"
 *  - 增加云端媒体数统计（pack 候选无媒体）
 *
 * 用法：pnpm exec tsx scripts/case-audit/cloud-audit.mts
 * 输出：outputs/case-library-review/20261024/cloud-audit/<caseId>.json + cloud-audit-ledger.md
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sourceExamDefinitions } from '@/domain/exam-methods';
import { patientAppearance } from '@/domain/patient-appearance';
import { parseAgeToDays, resolveCommunicationProfile, toAgeBand } from '@/domain/communication-profile';

const ROOT = process.cwd();
const SNAP_DIR = path.join(ROOT, 'outputs/case-library-review/20261024/cloud-snapshot');
const OUT_DIR = path.join(ROOT, 'outputs/case-library-review/20261024/cloud-audit');
mkdirSync(OUT_DIR, { recursive: true });

if (!existsSync2(SNAP_DIR)) {
  console.error(`cloud-snapshot 不存在：${SNAP_DIR}（先运行 cloud-snapshot.mts）`);
  process.exit(1);
}
function existsSync2(p: string) { try { readdirSync(p); return true; } catch { return false; } }

type Status = 'pass' | 'flag' | 'not_verified';
interface ItemResult { status: Status; evidence: string }

interface SnapshotDoc { source: string; sha256: string; text: string }
interface SnapshotData {
  caseId: string;
  sourceName: string;
  age: string;
  sex: string;
  complaint: string;
  sections: Record<'history' | 'exam' | 'tests' | 'diagnosis' | 'plan', string>;
  documents?: SnapshotDoc[];
  vitals?: { temperature?: number; heartRate?: number; respiratoryRate?: number };
}
interface SnapshotMeta { version: string; chunkCount: number; mediaCount: number }

function auditSnapshot(caseId: string, data: SnapshotData, meta: SnapshotMeta): Record<string, ItemResult> {
  const r: Record<string, ItemResult> = {};
  const rec = data;
  const allText = [
    rec.sections?.history ?? '', rec.sections?.exam ?? '', rec.sections?.tests ?? '',
    rec.sections?.diagnosis ?? '', rec.sections?.plan ?? '',
    ...(rec.documents ?? []).map((d: { text: string }) => d.text),
  ].join('\n');

  // ---------- A ----------
  r.A01 = meta?.version && rec.caseId === caseId
    ? { status: 'pass', evidence: `快照版本指纹 v=${meta.version.slice(0, 12)}（分片 ${meta.chunkCount}）；caseId 一致` }
    : { status: 'flag', evidence: `版本或 caseId 异常：v=${meta?.version ?? 'null'} inner=${rec.caseId}` };

  // 与运行时 extractSnapshotDemographics 同口径：兼容"患儿/患者"句式
  const hm = /(?:患儿|患者)[，,]?\s*(男|女)\s*[，,]\s*([^；;，,。\n]{1,20})/.exec(rec.sections?.history ?? '');
  const sexOk = hm ? hm[1] === rec.sex : false;
  const ageOk = hm ? hm[2].replace(/\s/g, '') === String(rec.age).replace(/\s/g, '') : false;
  r.A02 = hm && sexOk && ageOk
    ? { status: 'pass', evidence: `病史首句与顶层一致：${hm[1]}/${hm[2]}` }
    : { status: 'flag', evidence: `首句解析=${hm ? hm[0] : '未命中'}；sex=${rec.sex} age=${rec.age}；需人工核对` };

  const dateSet = new Set<string>();
  for (const m of (rec.sections?.tests ?? '').matchAll(/\[(\d{4}-\d{2}-\d{2})\]/g)) dateSet.add(m[1]);
  for (const m of (rec.sections?.tests ?? '').matchAll(/[（(](\d{4})(\d{2})(\d{2})[)）]/g)) dateSet.add(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of (rec.sections?.tests ?? '').matchAll(/(?<![\d-])(\d{4}-\d{2}-\d{2})/g)) dateSet.add(m[1]);
  const dayMonth = new Set<string>();
  for (const m of (rec.sections?.tests ?? '').matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?=[一-龥A-Za-z])/g)) dayMonth.add(`${m[2]}/${m[1]}`);
  const dates = [...dateSet].sort();
  r.A03 = dates.length > 0
    ? { status: 'pass', evidence: `检验日期锚点 ${dates.length} 个：${dates[0]} ~ ${dates[dates.length - 1]}${dayMonth.size ? `；另有日/月锚点 ${dayMonth.size} 个` : ''}` }
    : dayMonth.size > 0
      ? { status: 'pass', evidence: `无 ISO 日期，但含中式日/月锚点 ${dayMonth.size} 个（${[...dayMonth].sort().join('、')}）` }
      : { status: 'flag', evidence: 'tests 段无任何日期锚点' };

  r.A04 = { status: 'not_verified', evidence: '交接方运行验证记录随 pack 丢失，待重传后补核' };
  r.L01 = r.A04;

  const docs: Array<{ source: string; sha256: string }> = rec.documents ?? [];
  const docShaOk = docs.every((d) => /^[0-9a-f]{64}$/.test(d.sha256));
  r.A05 = docShaOk
    ? { status: 'pass', evidence: `documents ${docs.length} 份：sha256 格式合规` }
    : { status: 'flag', evidence: `documents ${docs.length} 份：sha256 格式异常` };

  // ---------- B ----------
  const days = parseAgeToDays(String(rec.age));
  const band = toAgeBand(days);
  const app = patientAppearance(rec.sex, 'standing', caseId, String(rec.age));
  const bandKeyExpected: Record<string, string> = { toddler: 'toddler-', school: 'school-', adolescent: 'adolescent-', newborn: 'newborn-', infant: 'newborn-' };
  const expectPrefix = bandKeyExpected[band as string];
  if (expectPrefix) {
    r.B02 = app.key.startsWith(expectPrefix)
      ? { status: 'pass', evidence: `年龄 ${rec.age} → 分档 ${band} → 素材 ${app.key}（路由正确）` }
      : { status: 'flag', evidence: `分档 ${band} 但素材 ${app.key} 不匹配（路由异常）` };
  } else {
    r.B02 = { status: 'flag', evidence: `分档 ${band}（preschool/未知）走通用哈希素材 ${app.key}——学龄前无专属分档素材（已知缺口）` };
  }
  r.B05 = app.alt.includes('非病例本人')
    ? { status: 'pass', evidence: `alt 含"非病例本人"教学示意声明（${app.key}）` }
    : { status: 'flag', evidence: `alt 缺少非本人声明：${app.alt}` };

  // ---------- C ----------
  const hist = rec.sections?.history ?? '';
  r.C02 = /伴|口服|予|治疗|检查|就诊/.test(hist)
    ? { status: 'pass', evidence: '现病史含症状演变/伴随/已做检查用药要素' }
    : { status: 'flag', evidence: '现病史要素稀薄，需人工判断覆盖度' };
  const young = band === 'newborn' || band === 'infant' || band === 'toddler' || band === 'preschool';
  r.C03 = young
    ? (/出生|孕|产|喂养|接种|预防接种|生长发育/.test(hist)
      ? { status: 'pass', evidence: `低龄病例（${band}）含围产/喂养/接种类信息` }
      : { status: 'flag', evidence: `低龄病例（${band}）病史未见围产/喂养/接种类信息，需人工核对` })
    : (/既往|过敏|家族|接种/.test(hist)
      ? { status: 'pass', evidence: '学龄/青少年病例含既往/过敏/家族类信息' }
      : { status: 'flag', evidence: '既往/过敏/家族史要素未见，需人工核对' });
  r.C04 = /否认|无.{0,6}史|未测|未做|未提供/.test(hist)
    ? { status: 'pass', evidence: '含"否认/无/未"语义表达' }
    : { status: 'flag', evidence: '未见明确阴性史语义，需人工核对' };

  // ---------- D ----------
  const profile = resolveCommunicationProfile(caseId, String(rec.age));
  const cap = profile.speechCapability;
  r.D01 = (band === 'newborn' || band === 'infant')
    ? (cap === 'nonverbal'
      ? { status: 'pass', evidence: `${band} → nonverbal（新生儿不得口头讲病史，机制正确）` }
      : { status: 'flag', evidence: `${band} 但 speechCapability=${cap}，能力档位异常` })
    : { status: 'pass', evidence: `${band} → speechCapability=${cap}（年龄默认档）` };

  // ---------- E ----------
  const exams = sourceExamDefinitions(rec.sections?.exam ?? '');
  const withContent = exams.filter((e) => (e[3] ?? '').trim().length > 0);
  r.E02 = withContent.length > 0
    ? { status: 'pass', evidence: `查体解析 ${withContent.length}/18 项有内容：${withContent.map((e) => e[2]).join('、')}` }
    : { status: 'flag', evidence: '查体段未解析出任何有内容查体项' };
  r.E05 = r.E02.status === 'pass'
    ? { status: 'pass', evidence: '解析器对本例查体段有效覆盖' }
    : { status: 'flag', evidence: '同 E02' };

  // ---------- F ----------
  const testLines = (rec.sections?.tests ?? '').split('\n').map((s: string) => s.trim()).filter(Boolean);
  r.F01 = testLines.length > 0 || docs.length > 0
    ? { status: 'pass', evidence: `辅检文本 ${testLines.length} 行、独立文档 ${docs.length} 份` }
    : { status: 'flag', evidence: '辅检与文档均为空——需人工核对是否源材料即无辅检' };
  r.F04 = { status: 'not_verified', evidence: '云端快照无 testRelease 字段（分时点门控待全量合并阶段接入）' };

  // ---------- J ----------
  const piiHits: string[] = [];
  const piiPatterns: Array<[RegExp, string]> = [
    [/姓名[：:]\s*(?!\[|已隐)([一-龥]{2,4})/g, '姓名未掩码'],
    [/住院号[：:]?\s*(\d{5,})/g, '住院号未掩码'],
    [/床号[：:]?(\d+)/g, '床号未掩码'],
    [/身份证[号]?[：:]?\s*(\d{6,})/g, '身份证未掩码'],
    // 手机号需排除云盘图片 URL 内嵌的十六进制文件 ID 片段（前后均为字母数字时不判）
    [/(?<![0-9a-zA-Z])1[3-9]\d{9}(?![0-9a-zA-Z])/g, '疑似手机号'],
  ];
  for (const [re, label] of piiPatterns) {
    const hits = [...allText.matchAll(re)].slice(0, 3).map((m) => m[0].slice(0, 24));
    if (hits.length) piiHits.push(`${label}: ${hits.join(' / ')}`);
  }
  const maskedCount = (allText.match(/\[身份信息已隐去\]/g) ?? []).length;
  r.J01 = piiHits.length === 0
    ? { status: 'pass', evidence: `文本 PII 扫描无未掩码命中；已掩码标记 ${maskedCount} 处（cloud 侧 clean() 脱敏已生效）` }
    : { status: 'flag', evidence: `疑似未掩码 PII：${piiHits.join('；')}（需人工确认）` };
  r.J05 = r.J01;

  // ---------- K ----------
  const examText = rec.sections?.exam ?? '';
  const v: NonNullable<SnapshotData['vitals']> = rec.vitals ?? {};
  const vitChecks: string[] = [];
  const tM = /(?<![A-Za-z])T\s*[:：]?\s*(\d{2}\.?\d*)\s*℃/.exec(examText);
  if (tM && v.temperature != null) vitChecks.push(Math.abs(parseFloat(tM[1]) - v.temperature) < 0.01 ? 'T✓' : `T不一致(${tM[1]}vs${v.temperature})`);
  const pM = /(?<![A-Za-z])P\s*[:：]?\s*(\d+)\s*次/.exec(examText);
  if (pM && v.heartRate != null) vitChecks.push(Number(pM[1]) === v.heartRate ? 'P✓' : `P不一致(${pM[1]}vs${v.heartRate})`);
  const rM = /(?<![A-Za-z])R\s*[:：]?\s*(\d+)\s*次/.exec(examText);
  if (rM && v.respiratoryRate != null) vitChecks.push(Number(rM[1]) === v.respiratoryRate ? 'R✓' : `R不一致(${rM[1]}vs${v.respiratoryRate})`);
  const vitBad = vitChecks.filter((s) => s.includes('不一致'));
  r.K01 = vitBad.length === 0
    ? { status: 'pass', evidence: `vitals 与查体文本核对：${vitChecks.join(' ') || '查体文本无 T/P/R 数值（不编造）'}` }
    : { status: 'flag', evidence: `vitals 与查体文本不一致：${vitBad.join(' ')}` };

  const structOk = typeof rec.caseId === 'string' && typeof rec.sourceName === 'string'
    && typeof rec.age === 'string' && typeof rec.sex === 'string' && typeof rec.complaint === 'string'
    && rec.sections && ['history', 'exam', 'tests', 'diagnosis', 'plan'].every((k) => typeof rec.sections[k] === 'string')
    && Array.isArray(rec.documents) && rec.vitals && typeof rec.vitals === 'object';
  r.K03 = structOk
    ? { status: 'pass', evidence: '快照结构要件齐全（SnapshotCaseData 全字段）' }
    : { status: 'flag', evidence: '结构要件缺失或类型异常' };

  return r;
}

// ---------- 主流程 ----------
const files = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'));
const ledgerRows: string[] = [];
const summary = { pass: 0, flag: 0, not_verified: 0, cases: 0, flaggedCases: [] as string[] };

for (const f of files.sort()) {
  const payload = JSON.parse(readFileSync(path.join(SNAP_DIR, f), 'utf8'));
  const caseId: string = payload.caseId;
  const results = auditSnapshot(caseId, payload.data, payload.meta);
  const counts = { pass: 0, flag: 0, not_verified: 0 };
  for (const val of Object.values(results)) counts[val.status] += 1;
  summary.pass += counts.pass; summary.flag += counts.flag; summary.not_verified += counts.not_verified;
  summary.cases += 1;
  if (counts.flag > 0) summary.flaggedCases.push(`${caseId}(${counts.flag}flag)`);

  const d = payload.data;
  const band = toAgeBand(parseAgeToDays(String(d.age)));
  const app = patientAppearance(d.sex, 'standing', caseId, String(d.age));
  const exams = sourceExamDefinitions(d.sections?.exam ?? '').filter((e) => (e[3] ?? '').trim().length > 0);

  writeFileSync(path.join(OUT_DIR, `${caseId}.json`), JSON.stringify({
    caseId,
    auditedAt: '2026-10-24',
    auditRound: 'cloud-mechanical-r1',
    disclaimer: '云端现状机械审计：学生经 KB 召回真实获得的事实集；pass≠医学内容验收',
    cloudVersion: payload.meta.version,
    cloudMedia: payload.meta.mediaCount,
    age: d.age, sex: d.sex, ageBand: band, assetKey: app.key,
    examContentCount: exams.length,
    results,
    counts,
  }, null, 2));

  const flagItems = Object.entries(results).filter(([, val]) => val.status === 'flag').map(([k]) => k);
  ledgerRows.push(`| ${caseId} | ${d.age}/${d.sex} | ${band} | ${app.key} | ${exams.length} | ${payload.meta.mediaCount} | ${counts.pass} | ${counts.flag} | ${flagItems.join('、') || '—'} |`);
}

const ledger = `# 云端现状机械审计台账（KB 召回快照 = 学生真实获得事实集，2026-10-24）

- 范围：cloud-snapshot 已固化 ${files.length} 例（53 有源病例中 48 召回成功；5 例空召回根因 A' 待教师补登 KB 标题）
- 口径：与 pack 侧 batch-audit 同一套 18 机械项；A04/L01 待 pack 重传补核；F04 云端无 testRelease（待合并）
- 汇总：pass ${summary.pass} / flag ${summary.flag} / not_verified ${summary.not_verified}

| 病例 | 年龄/性别 | 分档 | 素材 | 查体项 | 云端媒体 | pass | flag | flag 条目 |
|------|-----------|------|------|--------|----------|------|------|-----------|
${ledgerRows.join('\n')}

## 需人工跟进的 flag 病例
${summary.flaggedCases.map((s) => `- ${s}`).join('\n') || '（无）'}
`;
writeFileSync(path.join(ROOT, 'outputs/case-library-review/20261024/cloud-audit-ledger.md'), ledger);
console.log(`audited ${summary.cases} cloud snapshots; pass=${summary.pass} flag=${summary.flag} nv=${summary.not_verified}`);
console.log(`flagged: ${summary.flaggedCases.join('; ') || 'none'}`);
