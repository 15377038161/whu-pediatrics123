// 服务端接诊信息：只从受控病例事实取主诉，不把诊断目录导入客户端。
import { CASE_CATALOG, type PublicCaseProfile } from '@/domain/case-catalog';
import { getCase } from '@/domain/case';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { getTeacherSourceId, readTeacherCaseData, type TeacherCaseData } from '@/lib/teacher-case-data';

export function verifiedComplaint(source: TeacherCaseData | null): string | null {
  const complaint = source?.complaint.trim().replace(/^主诉\s*[:：]\s*/, '');
  if (!complaint || complaint.length < 2 || complaint.length > 100 || /未记录|待核验|资料不足|诊断|病例|姓名|住院号/.test(complaint)) return null;
  if (TEACHER_CASE_CATALOG.some(item => complaint.includes(item.name))) return null;
  return complaint;
}

export function admissionProfile(profile: PublicCaseProfile): PublicCaseProfile {
  if (!profile.id.startsWith('teacher-')) return profile;
  const source = readTeacherCaseData(profile.id);
  const complaint = verifiedComplaint(source);
  return { ...profile, title: complaint ?? '待补充接诊信息', presentingSymptoms: complaint ? [complaint] : [],
    age: source?.age || '待核验', sex: source?.sex === '男' || source?.sex === '女' ? source.sex : '待核验' };
}

export interface AdmissionCandidate { caseId: string; sourceId: string }
export function eligibleAdmissions(unpublished: ReadonlySet<string>): AdmissionCandidate[] {
  return CASE_CATALOG.flatMap(profile => {
    if (unpublished.has(profile.id) || profile.contentStatus === 'demo-pending-review') return [];
    const definition = getCase(profile.id);
    const source = definition.sourceFacts;
    if (source !== undefined && (!verifiedComplaint(source) || !source?.sections.history.trim() || !source.sections.exam.trim() || !source.sections.tests.trim())) return [];
    return [{ caseId: profile.id, sourceId: getTeacherSourceId(profile.id) }];
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
