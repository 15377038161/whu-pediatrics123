import { resolveCaseId } from '@/lib/case-identity';
// 服务端接诊信息：只从受控病例事实取主诉，不把诊断目录导入客户端。
import { CASE_CATALOG, type PublicCaseProfile } from '@/domain/case-catalog';
import { getCase } from '@/domain/case';
import { verifiedComplaint } from '@/lib/admission-complaint';
export { verifiedComplaint } from '@/lib/admission-complaint';
import { getTeacherSourceId, readTeacherCaseData } from '@/lib/teacher-case-data';


export function admissionProfile(profile: PublicCaseProfile): PublicCaseProfile {
  if (!resolveCaseId(profile.id).startsWith('teacher-')) return profile;
  const source = readTeacherCaseData(resolveCaseId(profile.id));
  const complaint = verifiedComplaint(source);
  return { ...profile, title: complaint ?? '待补充接诊信息', presentingSymptoms: complaint ? [complaint] : [],
    age: source?.age || '待核验', sex: source?.sex === '男' || source?.sex === '女' ? source.sex : '待核验' };
}

export interface AdmissionCandidate { caseId: string; sourceId: string }
export function eligibleAdmissions(unpublished: ReadonlySet<string>): AdmissionCandidate[] {
  return CASE_CATALOG.flatMap(profile => {
    if (unpublished.has(resolveCaseId(profile.id)) || profile.contentStatus === 'demo-pending-review') return [];
    const definition = getCase(profile.id);
    const source = definition.sourceFacts;
    if (source !== undefined && (!verifiedComplaint(source) || !source?.age.trim() || /待核验|未记录/.test(source.age) ||
      !source.sections.history.trim() || !source.sections.exam.trim() || !source.sections.tests.trim() ||
      !source.sections.diagnosis.trim() || !source.sections.plan.trim())) return [];
    return [{ caseId: resolveCaseId(profile.id), sourceId: getTeacherSourceId(resolveCaseId(profile.id)) }];
  });
}

export function selectAdmission(candidates: AdmissionCandidate[], excludedCase?: string, allowRepeat = false, random = Math.random): string {
  // 合并同源别名，不让同一份病历因目录条目较多而提高抽中概率。
  const bySource = new Map(candidates.map(item => [item.sourceId, item.caseId]));
  const excludedSource = excludedCase ? getTeacherSourceId(excludedCase) : null;
  const available = [...bySource].filter(([source]) => source !== excludedSource);
  if (!bySource.size) throw new Error('NO_ELIGIBLE_CASE');
  if (!available.length) {
    if (allowRepeat) return [...bySource.values()][0];
    throw new Error('ONLY_CURRENT_CASE');
  }
  return available[Math.min(available.length - 1, Math.floor(random() * available.length))][1];
}
