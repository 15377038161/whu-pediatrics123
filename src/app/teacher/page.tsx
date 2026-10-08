import { TeacherDashboard } from '@/components/teacher-dashboard';
import { AgentRepository } from '@/lib/repository';
import { requirePageUser } from '@/lib/page-auth';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';

export default async function TeacherPage() {
  const user = await requirePageUser('teacher');
  const students = await new AgentRepository(user).listTeacherStudents();
  return <TeacherDashboard students={students} referenceTime={new Date().toISOString()} caseCatalog={TEACHER_CASE_CATALOG} />;
}
