/** 仅发布经主诉校验的年龄、性别、症状；原始病历与来源标识不进入产物。 */
import { writeFileSync } from 'node:fs';
import { CASE_CATALOG } from '../src/domain/case-catalog';
import { resolveCaseId } from '../src/lib/case-identity';
import { readTeacherCaseData } from '../src/lib/teacher-case-data';
import { verifiedComplaint } from '../src/lib/admission-complaint';

const summaries: Record<string, { age: string; sex: '男' | '女' | '待核验'; complaint: string }> = {};
for (const profile of CASE_CATALOG.filter(item => item.id.startsWith('case-'))) {
  const source = readTeacherCaseData(resolveCaseId(profile.id));
  const complaint = verifiedComplaint(source);
  if (!source || !complaint) continue;
  summaries[profile.id] = { age: source.age, sex: source.sex === '男' || source.sex === '女' ? source.sex : '待核验', complaint };
}
if (Object.keys(summaries).length < 67) throw new Error('接诊资料不完整，拒绝覆盖已发布摘要');
writeFileSync('src/domain/admission-summaries.json', JSON.stringify(summaries, null, 2) + '\n');
