import type { TeacherCaseData } from '@/lib/teacher-case-data';

// Server-side equivalent of exact, controlled local source files. Never a student projection cache.
const records = new Map<string, TeacherCaseData>();
export function registerControlledCase(record: TeacherCaseData, version: string): void {
  records.set(`${record.caseId}@${version}`, record);
}
export function getControlledCase(caseId: string, version?: string | null): TeacherCaseData | null {
  return version ? records.get(`${caseId}@${version}`) ?? null : null;
}
export function hasControlledCase(caseId: string): boolean {
  return [...records.keys()].some(key => key.startsWith(`${caseId}@`));
}
