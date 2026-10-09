import { GatedAppShell } from '@/components/auth-gate';

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <GatedAppShell role="student">{children}</GatedAppShell>;
}
