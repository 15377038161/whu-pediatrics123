import { GatedAppShell } from '@/components/auth-gate';

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <GatedAppShell role="teacher">{children}</GatedAppShell>;
}
