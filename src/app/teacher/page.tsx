import { TeacherDashboard } from '@/components/teacher-dashboard';
import { AgentRepository } from '@/lib/repository';
import { requirePageUser } from '@/lib/page-auth';

export default async function TeacherPage() {
  const user = await requirePageUser('teacher');
  const students = await new AgentRepository(user).listTeacherStudents();
  return <TeacherDashboard students={students} />;
}
