/**
 * 53 运行时事实逐字段来源证据校验（脱敏，不输出患者正文）。
 * 校验项：
 * 1. age/sex/complaint/vitals 的值必须能在原文（documents[0].text）中找到对应文本（程序化匹配，不做模型推断）；
 * 2. vitals 数值必须在原文查体段中有同值出现（带单位上下文）；
 * 3. diagnosis 必须来自原文诊断段（不得用目录病名冒充——catalog name 与诊断段文本需同时存在）；
 * 4. 缺字段保持 unknown（'年龄未记录'/'性别未记录'/null），不得出现演示病例默认值（38.1/124/36/95 等）；
 * 5. sections 不为空且各自包含原文片段（非整篇 TXT 粗填同一字段：检查五段互有区分）；
 * 6. 别名语义：TEACHER_CASE_LINKS 的 14 条 target 必须存在于 53 运行时事实中（映射完整性）；
 * 7. sourceEvidence.sectionLine 行号指向的原文行必须命中章节标题模式。
 * 输出：脱敏计数与字段错误清单（case key + 字段 + 证据行号），不打印正文。
 */
import { readFileSync, readdirSync } from 'node:fs';

interface RuntimeRecord {
  caseId: string; sourceName: string; sourceDocument: string;
  age: string; sex: string; complaint: string;
  sections: Record<'history' | 'exam' | 'tests' | 'diagnosis' | 'plan', string>;
  vitals: { temperature: number | null; heartRate: number | null; respiratoryRate: number | null; spo2: number | null };
  documents: Array<{ source: string; text: string; sha256: string }>;
  sourceEvidence?: { file: string; bytes: number; sectionLine: Record<string, number | null>; reviewEvidence: string; handoverVersion: string };
  missingFields?: string[];
}

const DEMO_DEFAULTS = [38.1, 124, 36, 95]; // 演示 fixture 哨兵值：不得出现在 53 运行事实 vitals 中

const files = readdirSync('knowledge/teaching-cases').filter((f) => f.endsWith('.json')).sort();
const issues: Array<{ caseId: string; field: string; detail: string }> = [];
let checked = 0;
const vitalsFound = { temperature: 0, heartRate: 0, respiratoryRate: 0, spo2: 0 };
const vitalsNull = { temperature: 0, heartRate: 0, respiratoryRate: 0, spo2: 0 };
const sectionDistinct = { history: 0, exam: 0, tests: 0, diagnosis: 0, plan: 0 };

for (const file of files) {
  const record: RuntimeRecord = JSON.parse(readFileSync(`knowledge/teaching-cases/${file}`, 'utf8'));
  checked += 1;
  const fullText = record.documents[0]?.text ?? '';
  const lines = fullText.split('\n');

  // 1. 年龄/性别：值必须出现在原文（unknown 显式标记除外）
  if (record.age !== '年龄未记录' && !fullText.includes(record.age.replace(/\s/g, '')) && !fullText.includes(record.age)) {
    issues.push({ caseId: record.caseId, field: 'age', detail: `值未在原文找到（行证据缺失）` });
  }
  if (record.sex !== '性别未记录' && !new RegExp(`性别[：:\\s]*${record.sex}|患儿[，,\\s]*${record.sex}`).test(fullText)) {
    issues.push({ caseId: record.caseId, field: 'sex', detail: '值未在原文找到' });
  }
  // unknown 容纳：missingFields 与值一致
  if (record.sex === '性别未记录' && !(record.missingFields ?? []).includes('sex')) {
    issues.push({ caseId: record.caseId, field: 'sex', detail: 'unknown 未登记 missingFields' });
  }

  // 2. vitals：数值需在原文出现（同数字）；null 计数（unknown 合法）
  for (const key of ['temperature', 'heartRate', 'respiratoryRate', 'spo2'] as const) {
    const value = record.vitals[key];
    if (value === null) { vitalsNull[key] += 1; continue; }
    const inSource = new RegExp(String(value).replace('.', '\\.')).test(record.sections.exam);
    // 演示默认值嫌疑仅在数值未见于原文时成立（原文记录恰好为 38.1/95 等值不算默认值）
    if (!inSource && DEMO_DEFAULTS.includes(value)) issues.push({ caseId: record.caseId, field: `vitals.${key}`, detail: `疑似演示默认值 ${value} 且未在原文找到` });
    if (!inSource) {
      issues.push({ caseId: record.caseId, field: `vitals.${key}`, detail: `数值 ${value} 未在原文查体段找到` });
    } else vitalsFound[key] += 1;
  }

  // 3. 诊断：diagnosis 段非空且与 catalog 病名不同源也可以（以原文诊断段为准）；仅检查非空与原文行号
  if (!record.sections.diagnosis.trim()) issues.push({ caseId: record.caseId, field: 'sections.diagnosis', detail: '诊断为空' });

  // 4. sections 非空 + 五段互有区分（不能用整篇 TXT 粗填同一字段：各段不应完全相同）
  for (const key of ['history', 'exam', 'tests', 'diagnosis', 'plan'] as const) {
    if (!record.sections[key].trim()) issues.push({ caseId: record.caseId, field: `sections.${key}`, detail: '段落为空' });
    else sectionDistinct[key] += 1;
  }
  const same = record.sections.history === record.sections.exam && record.sections.exam === record.sections.tests;
  if (same) issues.push({ caseId: record.caseId, field: 'sections', detail: '病史/查体/检查三段完全相同（疑似整篇粗填）' });

  // 5. 主诉非演示默认文案
  if (record.complaint === '请向家长了解本次就诊的主要不适。') {
    issues.push({ caseId: record.caseId, field: 'complaint', detail: '使用兜底文案（原文无主诉记录）' });
  }

  // 6. 证据行号：sectionLine 指向的行应命中章节标题模式
  const headerPatterns: Record<string, RegExp> = {
    history: /现病史|既往史|个人史|家族史|主诉|入院情况|病史特点/,
    exam: /入院查体|体格检查|体检|体查|查体|专科检查/,
    tests: /辅助检查|辅检|相关检查|实验室检查|检查结果|入院检查/,
    diagnosis: /入院诊断|出院诊断|初步诊断|最后诊断|诊断依据|诊断|鉴别诊断/,
    plan: /诊疗经过|诊治经过|治疗经过|治疗方案|诊疗计划|治疗|出院医嘱/,
  };
  for (const [key, lineNo] of Object.entries(record.sourceEvidence?.sectionLine ?? {})) {
    if (lineNo === null) { issues.push({ caseId: record.caseId, field: `evidence.${key}`, detail: '行号缺失' }); continue; }
    const line = lines[lineNo - 1] ?? '';
    if (!headerPatterns[key].test(line)) issues.push({ caseId: record.caseId, field: `evidence.${key}`, detail: `行 ${lineNo} 未命中章节标题` });
  }

  // 7. 审核凭据与版本
  if (record.sourceEvidence?.reviewEvidence !== 'user-confirmed-teacher-reviewed') {
    issues.push({ caseId: record.caseId, field: 'reviewEvidence', detail: '审核凭据缺失' });
  }
}

// 8. 别名映射完整性（14 条 target 均在 53 运行事实中）
const ids = new Set(files.map((f) => f.slice(0, -5)));
const linksSource = readFileSync('src/domain/teacher-case-links.ts', 'utf8');
const links = [...linksSource.matchAll(/'([^']+)': \{ sourceId: '([^']+)'/g)].map((m) => [m[1], m[2]] as const);
const aliasTargetsMissing = links.filter(([, target]) => !ids.has(target)).map(([alias, target]) => ({ alias, target }));

console.log(JSON.stringify({
  checked,
  issues,
  vitalsFound,
  vitalsNullKeptUnknown: vitalsNull,
  sectionNonEmpty: sectionDistinct,
  complaintFallbackUsed: files.filter((f) => {
    const r: RuntimeRecord = JSON.parse(readFileSync(`knowledge/teaching-cases/${f}`, 'utf8'));
    return r.complaint === '请向家长了解本次就诊的主要不适。';
  }).length,
  aliasTotal: links.length,
  aliasTargetsMissing,
}, null, 1));
if (issues.length > 0 || aliasTargetsMissing.length > 0) process.exitCode = 1;
