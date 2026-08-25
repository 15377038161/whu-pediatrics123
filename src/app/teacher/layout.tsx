import { AppShell } from '@/components/app-shell';
import { requirePageUser } from '@/lib/page-auth';

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser('teacher');
  return <AppShell user={user}>{children}</AppShell>;
}
