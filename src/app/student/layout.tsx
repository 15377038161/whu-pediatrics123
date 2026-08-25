import { AppShell } from '@/components/app-shell';
import { requirePageUser } from '@/lib/page-auth';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser('student');
  return <AppShell user={user}>{children}</AppShell>;
}
