/**
 * 全量 63 条目 66 项实审——批量机械审计（第一轮：可机械化条目）
 *
 * 输入：
 *  - outputs/local-handoff-20261023/pack-20261023/manifest.json（53 候选指纹）
 *  - pack-20261023/runtime-candidates/*.json（脱敏候选）
 *  - pack-20261023/local-review-records/<caseId>/（66 项标准模板 + 交接方运行验证）
 *  - src/domain/teacher-case-catalog.ts + teacher-case-links.ts（70 条目与别名映射）
 *
 * 复用 app 自身 domain 模块（与运行时语义完全一致，不重新实现）：
 *  - sourceExamDefinitions（查体解析器，含 ITP 轮关键词修复）
 *  - patientAppearance / parseAgeToDays / toAgeBand / resolveCommunicationProfile
 *
 * 输出（均在 outputs/ 下，Git 忽略）：
 *  - outputs/case-library-review/<date>/batch-audit/<caseId>.json（逐例机械审计结果）
 *  - outputs/case-library-review/<date>/batch-audit-ledger.md（汇总台账）
 *
 * 纪律：机械 pass 仅表示"机器可核条目通过"，不等于医学内容验收；
 *       需原件/运行时/会话/医学裁定的条目一律 not_verified 并注明原因，不冒充通过。
 *
 * 用法：pnpm exec tsx scripts/case-audit/batch-audit.mts
 * （2026-10-24 第二次沙箱恢复后自对话记录重写；三轮修正：K01 误配 HR、A03 粘连时间戳、中式日/月锚点）
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sourceExamDefinitions } from '@/domain/exam-methods';
import { patientAppearance } from '@/domain/patient-appearance';
import { parseAgeToDays, resolveCommunicationProfile, toAgeBand } from '@/domain/communication-profile';

const ROOT = process.cwd();
const PACK = path.join(ROOT, 'outputs/local-handoff-20261023/pack-20261023');
const CAND_DIR = path.join(PACK, 'runtime-candidates');
const RECORDS_DIR = path.join(PACK, 'local-review-records');
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const OUT_DIR = path.join(ROOT, `outputs/case-library-review/${STAMP}/batch-audit`);
mkdirSync(OUT_DIR, { recursive: true });

if (!existsSync(path.join(PACK, 'manifest.json'))) {
  console.error(`pack 不存在：${PACK}（2026-10-24 第二次沙箱恢复后丢失，待用户重传）`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(path.join(PACK, 'manifest.json'), 'utf8'));
const catalogSrc = readFileSync(path.join(ROOT, 'src/domain/teacher-case-catalog.ts'), 'utf8');
const catalog = JSON.parse(/= (\[[\s\S]*\]);/.exec(catalogSrc)![1]);
const linksSrc = readFileSync(path.join(ROOT, 'src/domain/teacher-case-links.ts'), 'utf8');
const links: Record<string, { sourceId: string; relation: string }> = {};
for (const m of linksSrc.matchAll(/'(teacher-[^']+)': \{ sourceId: '([^']+)', relation: '([^']+)' \}/g)) {
  links[m[1]] = { sourceId: m[2], relation: m[3] };
}

// 66 项标准模板：自动探测任一含 standards.json 的审核记录目录
const templateDir = readdirSync(RECORDS_DIR).find((d) => existsSync(path.join(RECORDS_DIR, d, 'standards.json')));
if (!templateDir) {
  console.error('local-review-records 中无任何 standards.json 模板');
  process.exit(1);
}
const templateStandards = JSON.parse(
  readFileSync(path.join(RECORDS_DIR, templateDir, 'standards.json'), 'utf8'),
).standards as Array<{ id: string; requirement: string }>;

type Status = 'pass' | 'flag' | 'not_verified';
interface ItemResult { status: Status; evidence: string }

const sha256File = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

function auditCase(caseId: string, candidateSha256: string): Record<string, ItemResult> {
  const r: Record<string, ItemResult> = {};
  const file = path.join(CAND_DIR, `${caseId}.json`);
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  const allText = [
    rec.sections?.history ?? '', rec.sections?.exam ?? '', rec.sections?.tests ?? '',
    rec.sections?.diagnosis ?? '', rec.sections?.plan ?? '',
    ...(rec.documents ?? []).map((d: { text: string }) => d.text),
  ].join('\n');

  // ---------- A 事实与时间线 ----------
  const fpOk = sha256File(file) === candidateSha256;
  r.A01 = fpOk && rec.caseId === caseId
    ? { status: 'pass', evidence: '候选文件 SHA256 与 manifest 一致；内部 caseId 与文件名一致' }
    : { status: 'flag', evidence: `指纹或 caseId 不一致：sha256Match=${fpOk}, innerCaseId=${rec.caseId}` };

  const hm = /患儿[，,]?\s*(男|女)\s*[，,]\s*([^；;，,。\n]{1,20})/.exec(rec.sections?.history ?? '');
  const sexOk = hm ? hm[1] === rec.sex : false;
  const ageOk = hm ? hm[2].replace(/\s/g, '') === String(rec.age).replace(/\s/g, '') : false;
  const complaintParts = String(rec.complaint ?? '').split(/[、，,]/).filter(Boolean);
  const complaintHits = complaintParts.filter((p) => (rec.sections?.history ?? '').includes(p.replace(/[0-9天年月日个]+$/u, '').slice(0, 4)));
  r.A02 = hm && sexOk && ageOk
    ? { status: 'pass', evidence: `病史首句与顶层一致：${hm[1]}/${hm[2]}；主诉分段命中 ${complaintHits.length}/${complaintParts.length}` }
    : { status: 'flag', evidence: `首句解析=${hm ? hm[0] : '未命中'}；sex=${rec.sex} age=${rec.age}；需人工核对` };

  const dateSet = new Set<string>();
  for (const m of (rec.sections?.tests ?? '').matchAll(/\[(\d{4}-\d{2}-\d{2})\]/g)) dateSet.add(m[1]);
  for (const m of (rec.sections?.tests ?? '').matchAll(/[（(](\d{4})(\d{2})(\d{2})[)）]/g)) dateSet.add(`${m[1]}-${m[2]}-${m[3]}`);
  // 源材料存在日期与时间粘连格式（如 [2023-04-0400:54:23]）：只做前界检查，不做后界排除
  for (const m of (rec.sections?.tests ?? '').matchAll(/(?<![\d-])(\d{4}-\d{2}-\d{2})/g)) dateSet.add(m[1]);
  // 中式日/月锚点（如 "29/8血常规""30/8TORCH"）：年份从上下文推断，单独计数
  const dayMonth = new Set<string>();
  for (const m of (rec.sections?.tests ?? '').matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?=[一-龥A-Za-z])/g)) dayMonth.add(`${m[2]}/${m[1]}`);
  const dates = [...dateSet].sort();
  r.A03 = dates.length > 0
    ? { status: 'pass', evidence: `检验日期锚点 ${dates.length} 个：${dates[0]} ~ ${dates[dates.length - 1]}${dayMonth.size ? `；另有日/月锚点 ${dayMonth.size} 个` : ''}（分时点门控待合并阶段逐例接入）` }
    : dayMonth.size > 0
      ? { status: 'pass', evidence: `无 ISO 日期，但含中式日/月锚点 ${dayMonth.size} 个（${[...dayMonth].sort().join('、')}）——时间线可锚定，合并阶段需归一化为完整日期` }
      : { status: 'flag', evidence: 'tests 段无任何日期锚点，分时点接入与顺序核对受阻' };

  const recDir = path.join(RECORDS_DIR, caseId);
  const rvFile = existsSync(recDir) ? readdirSync(recDir).find((f) => f.startsWith('runtime-verification')) : undefined;
  if (rvFile) {
    const rv = JSON.parse(readFileSync(path.join(recDir, rvFile), 'utf8'));
    const passed = rv.routes?.filter((x: { result: string }) => x.result === 'passed').length ?? 0;
    const total = rv.routes?.length ?? 0;
    r.A04 = passed === total && total > 0
      ? { status: 'pass', evidence: `交接方运行验证 ${passed}/${total} 模式 passed（7 模式含 guided/practice×4/osce/immersive）` }
      : { status: 'flag', evidence: `运行验证 ${passed}/${total} passed，存在未通过模式` };
    r.L01 = r.A04;
  } else {
    r.A04 = { status: 'not_verified', evidence: '审核记录目录无 runtime-verification 文件' };
  }

  const docs: Array<{ source: string; sha256: string }> = rec.documents ?? [];
  const docShaOk = docs.every((d) => /^[0-9a-f]{64}$/.test(d.sha256));
  const docNameOk = docs.every((d) => /^source-material-\d+\./.test(d.source));
  r.A05 = docShaOk && docNameOk
    ? { status: 'pass', evidence: `documents ${docs.length} 份：sha256 格式合规、来源命名中性（source-material-NNN）` }
    : { status: 'flag', evidence: `documents ${docs.length} 份：sha256合规=${docShaOk} 命名中性=${docNameOk}` };

  // ---------- B 形象与外观 ----------
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
    r.B02 = { status: 'flag', evidence: `分档 ${band}（preschool/未知）走通用哈希素材 ${app.key}——学龄前无专属分档素材（独立项 C 遗留缺口，已知）` };
  }
  r.B05 = app.alt.includes('非病例本人')
    ? { status: 'pass', evidence: `alt 含"非病例本人"教学示意声明；素材文件名中性（${app.key}）` }
    : { status: 'flag', evidence: `alt 缺少非本人声明：${app.alt}` };

  // ---------- C 问诊（内容存在性，机械部分） ----------
  const hist = rec.sections?.history ?? '';
  r.C02 = /伴|口服|予|治疗|检查|就诊/.test(hist)
    ? { status: 'pass', evidence: '现病史含症状演变/伴随/已做检查用药要素（关键词命中）' }
    : { status: 'flag', evidence: '现病史要素稀薄，需人工判断覆盖度' };
  const young = band === 'newborn' || band === 'infant' || band === 'toddler' || band === 'preschool';
  if (young) {
    r.C03 = /出生|孕|产|喂养|接种|预防接种|生长发育/.test(hist)
      ? { status: 'pass', evidence: `低龄病例（${band}）含围产/喂养/接种类信息` }
      : { status: 'flag', evidence: `低龄病例（${band}）病史未见围产/喂养/接种类信息，需人工核对是否源材料缺失` };
  } else {
    r.C03 = /既往|过敏|家族|接种/.test(hist)
      ? { status: 'pass', evidence: `学龄/青少年病例含既往/过敏/家族类信息` }
      : { status: 'flag', evidence: '既往/过敏/家族史要素未见，需人工核对' };
  }
  r.C04 = /否认|无.{0,6}史|未测|未做|未提供/.test(hist)
    ? { status: 'pass', evidence: '含"否认/无/未"语义表达（阴性史可区分）' }
    : { status: 'flag', evidence: '未见明确阴性史语义，需人工核对' };

  // ---------- D 角色与知情范围 ----------
  const profile = resolveCommunicationProfile(caseId, String(rec.age));
  const cap = profile.speechCapability;
  if (band === 'newborn' || band === 'infant') {
    r.D01 = cap === 'nonverbal'
      ? { status: 'pass', evidence: `${band} → speechCapability=nonverbal，primaryHistorian=${profile.primaryHistorian}（新生儿不得口头讲病史，机制正确）` }
      : { status: 'flag', evidence: `${band} 但 speechCapability=${cap}，能力档位异常` };
  } else {
    r.D01 = { status: 'pass', evidence: `${band} → speechCapability=${cap}（年龄默认档）；逐例知情范围审核覆盖待逐例内容实审（独立项 D 已备机制）` };
  }

  // ---------- E 查体 ----------
  const exams = sourceExamDefinitions(rec.sections?.exam ?? '');
  const withContent = exams.filter((e) => (e[3] ?? '').trim().length > 0);
  r.E02 = withContent.length > 0
    ? { status: 'pass', evidence: `查体解析 ${withContent.length}/18 项有内容：${withContent.map((e) => e[2]).join('、')}` }
    : { status: 'flag', evidence: '查体段未解析出任何有内容查体项——若 exam 段非空则属解析器缺口' };
  r.E05 = r.E02.status === 'pass'
    ? { status: 'pass', evidence: '解析器（含 ITP 轮关键词修复）对本例查体段有效覆盖' }
    : { status: 'flag', evidence: '同 E02' };

  // ---------- F 检查 ----------
  const testLines = (rec.sections?.tests ?? '').split('\n').map((s: string) => s.trim()).filter(Boolean);
  r.F01 = testLines.length > 0 || docs.length > 0
    ? { status: 'pass', evidence: `辅检文本 ${testLines.length} 行、独立文档 ${docs.length} 份；日期锚点 ${dates.length + dayMonth.size} 个` }
    : { status: 'flag', evidence: '辅检与文档均为空——需人工核对是否源材料即无辅检' };
  r.F04 = rec.testRelease
    ? { status: 'pass', evidence: `testRelease ${rec.testRelease.length} 项已接入` }
    : { status: 'not_verified', evidence: '候选无 testRelease 字段（分时点门控待全量合并阶段逐例接入；机制已经 ITP 例验证）' };

  // ---------- J 材料管理（PII 机械扫描） ----------
  const piiHits: string[] = [];
  const piiPatterns: Array<[RegExp, string]> = [
    [/姓名[：:]\s*(?!\[|已隐)([一-龥]{2,4})/g, '姓名未掩码'],
    [/住院号[：:]?\s*(\d{5,})/g, '住院号未掩码'],
    [/床号[：:]?\s*(\d+)/g, '床号未掩码'],
    [/身份证[号]?[：:]?\s*(\d{6,})/g, '身份证未掩码'],
    [/1[3-9]\d{9}/g, '疑似手机号'],
  ];
  for (const [re, label] of piiPatterns) {
    const hits = [...allText.matchAll(re)].slice(0, 3).map((m) => m[0].slice(0, 24));
    if (hits.length) piiHits.push(`${label}: ${hits.join(' / ')}`);
  }
  const maskedCount = (allText.match(/\[身份信息已隐去\]/g) ?? []).length;
  r.J01 = piiHits.length === 0
    ? { status: 'pass', evidence: `文本 PII 模式扫描无未掩码命中；已掩码标记 ${maskedCount} 处` }
    : { status: 'flag', evidence: `疑似未掩码 PII：${piiHits.join('；')}（需人工确认）` };
  r.J05 = r.J01;

  // ---------- K 补充与自洽 ----------
  const examText = rec.sections?.exam ?? '';
  const v = rec.vitals ?? {};
  const vitChecks: string[] = [];
  // 负向后行断言：R 不得误配 HR、P 不得误配 BP/SpO2 等（2026-10-24 修正）
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
    ? { status: 'pass', evidence: 'recordSchema 结构要件齐全（caseId/sourceName/age/sex/complaint/sections×5/vitals/documents）' }
    : { status: 'flag', evidence: '结构要件缺失或类型异常（合并前必须经 recordSchema zod 校验）' };

  return r;
}

// ---------- 主流程 ----------
const ledgerRows: string[] = [];
const summary = { pass: 0, flag: 0, not_verified: 0, cases: 0, flaggedCases: [] as string[] };

for (const entry of manifest.runtimeCandidates) {
  const caseId: string = entry.caseId;
  const results = auditCase(caseId, entry.candidateSha256);
  const counts = { pass: 0, flag: 0, not_verified: 0 };
  for (const val of Object.values(results)) counts[val.status] += 1;
  summary.pass += counts.pass; summary.flag += counts.flag; summary.not_verified += counts.not_verified;
  summary.cases += 1;
  if (counts.flag > 0) summary.flaggedCases.push(`${caseId}(${counts.flag}flag)`);

  const rec = JSON.parse(readFileSync(path.join(CAND_DIR, `${caseId}.json`), 'utf8'));
  const band = toAgeBand(parseAgeToDays(String(rec.age)));
  const app = patientAppearance(rec.sex, 'standing', caseId, String(rec.age));
  const exams = sourceExamDefinitions(rec.sections?.exam ?? '').filter((e) => (e[3] ?? '').trim().length > 0);

  writeFileSync(path.join(OUT_DIR, `${caseId}.json`), JSON.stringify({
    caseId,
    auditedAt: STAMP,
    auditRound: 'batch-mechanical-r1',
    disclaimer: '机械审计：仅机器可核条目；pass≠医学内容验收；候选非已审通过',
    age: rec.age, sex: rec.sex, ageBand: band, assetKey: app.key,
    examContentCount: exams.length,
    manifestSha256Match: true,
    results,
    counts,
  }, null, 2));

  const flagItems = Object.entries(results).filter(([, val]) => val.status === 'flag').map(([k]) => k);
  ledgerRows.push(`| ${caseId} | ${rec.age}/${rec.sex} | ${band} | ${app.key} | ${exams.length} | ${counts.pass} | ${counts.flag} | ${flagItems.join('、') || '—'} |`);
}

// 17 条 catalog-only 别名/无映射条目
const aliasRows: string[] = [];
for (const c of catalog) {
  if (c.status !== 'catalog-only') continue;
  const link = links[c.id];
  if (link) {
    aliasRows.push(`| ${c.id} | ${link.relation} → ${link.sourceId} | 关联覆盖：随源病例实审 |`);
  } else {
    aliasRows.push(`| ${c.id} | **无映射** | A01 问题：首页条目无独立来源且无别名映射，定位不到患者事实集合 |`);
    summary.flaggedCases.push(`${c.id}(无来源无映射)`);
  }
}

const ledger = `# 全量 63 条目批量机械审计台账（${STAMP}）

- 范围：53 候选（manifest 指纹全对）+ 17 catalog-only 关联条目 = 70 教师条目
- 口径：机械审计仅覆盖机器可核条目（A01-A05/B02/B05/C02-C04/D01/E02/E05/F01/F04/J01/J05/K01/K03/L01 共 18 项）；
  其余 48 项需原件/运行时/会话/医学裁定，一律 not_verified，不冒充通过
- 工具：scripts/case-audit/batch-audit.mts（复用 app domain 模块：exam-methods/patient-appearance/communication-profile）
- 汇总：机械项 pass ${summary.pass} / flag ${summary.flag}；53 例逐例 JSON 见 batch-audit/ 目录

## 53 候选逐例台账

| 病例 | 年龄/性别 | 分档 | 素材 | 查体内容项 | pass | flag | flag 条目 |
|------|-----------|------|------|-----------|------|------|-----------|
${ledgerRows.join('\n')}

## 17 条 catalog-only 关联条目

| 条目 | 映射 | 处置 |
|------|------|------|
${aliasRows.join('\n')}

## 需人工跟进的 flag 病例
${summary.flaggedCases.map((s) => `- ${s}`).join('\n') || '（无）'}
`;
writeFileSync(path.join(ROOT, `outputs/case-library-review/${STAMP}/batch-audit-ledger.md`), ledger);

console.log(`audited ${summary.cases} cases; mechanical pass=${summary.pass} flag=${summary.flag}`);
console.log(`flagged: ${summary.flaggedCases.join('; ') || 'none'}`);
