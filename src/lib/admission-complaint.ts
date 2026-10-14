import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import type { TeacherCaseData } from '@/lib/teacher-case-data';

export function verifiedComplaint(source: TeacherCaseData | null): string | null {
  const complaint = source?.complaint.trim().replace(/^主诉\s*[:：]\s*/, '');
  if (!complaint || complaint.length < 2 || complaint.length > 100 || /未记录|待核验|资料不足|诊断|病例|姓名|住院号/.test(complaint)) return null;
  if (TEACHER_CASE_CATALOG.some(item => complaint.includes(item.name))) return null;
  return complaint;
}

