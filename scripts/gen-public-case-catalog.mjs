/* eslint-disable no-console */
/**
 * 公开病例目录生成器（防透题，2026-10-12 第一批任务1）：
 * 从 src/domain/teacher-case-catalog.ts + teacher-case-links.ts 读取教师目录，
 * 生成学生侧客户端安全的中性目录字面量（病种名/源病种名不进入客户端 bundle），
 * 输出到 stdout，由维护者粘贴/写入 src/domain/case-catalog.ts 的 TEACHER_PUBLIC_ENTRIES 段。
 *
 * 用法：node scripts/gen-public-case-catalog.mjs
 * 新增/修改教师目录后需重新生成并提交（与服务端 teacher-case-catalog 保持同步）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const teacherText = readFileSync('src/domain/teacher-case-catalog.ts', 'utf8');
const catalog = JSON.parse(teacherText.slice(teacherText.indexOf('= [') + 2, teacherText.lastIndexOf(']') + 1));
const linksText = readFileSync('src/domain/teacher-case-links.ts', 'utf8');
// TS 单引号对象字面量：逐行正则提取（id -> { sourceId, relation }）
const links = {};
for (const m of linksText.matchAll(/'([^']+)'\s*:\s*\{\s*sourceId:\s*'([^']+)',\s*relation:\s*'(alias|subtype)'\s*\}/g)) {
  links[m[1]] = { sourceId: m[2], relation: m[3] };
}

const CATEGORY_NORMALIZATION = {
  '内分泌系统': '内分泌疾病',
  '心血管系统': '心血管系统疾病',
  '新生儿疾病': '新生儿与新生儿疾病',
  '神经系统疾病': '神经系统',
  '血液系统疾病': '造血系统疾病',
};
const normalizeCategory = (raw) => CATEGORY_NORMALIZATION[raw] ?? raw;

const subjectCount = new Map();
const lines = [];
for (const item of catalog) {
  const link = links[item.id];
  const subject = normalizeCategory(item.category);
  const no = (subjectCount.get(subject) ?? 0) + 1;
  subjectCount.set(subject, no);
  const title = `${subject} · 真实病例 ${String(no).padStart(2, '0')}`;
  const relation = link?.relation === 'subtype' ? 'subtype' : link?.relation === 'alias' ? 'alias' : null;
  const contentStatus = item.status === 'materials-indexed' ? 'teacher-materials-indexed' : item.status === 'folder-only' ? 'teacher-folder-only' : 'teacher-catalog-only';
  lines.push(`  { id: ${JSON.stringify(item.id)}, title: ${JSON.stringify(title)}, subtitle: ${JSON.stringify(link ? (relation === 'subtype' ? '关联真实亚型病例' : '教师病例学习') : '教师病例学习')}, category: ${JSON.stringify(item.category)}, sourceRelation: ${relation ? JSON.stringify(relation) : 'null'}, contentStatus: '${contentStatus}', mediaCount: ${item.mediaCount}, documentCount: ${item.documentCount} },`);
}

const block = `// 本段由 scripts/gen-public-case-catalog.mjs 生成（教师目录变更后需重新生成）：
// 教师病例条目为客户端安全中性目录——病种名/源病种名不进入本文件（防透题），
// 服务端按 id 解析原始事实（teacher-case-data），完成后经报告 caseTitle 释放病种名。
export const TEACHER_PUBLIC_ENTRIES: TeacherPublicEntry[] = [
${lines.join('\n')}
];
`;

writeFileSync('scripts/.gen-teacher-public-entries.tmp.ts', block);
console.log(`生成 ${lines.length} 条教师病例中性条目 -> scripts/.gen-teacher-public-entries.tmp.ts（用后删除，不入 git）`);
