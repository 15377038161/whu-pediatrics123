'use client';

import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import type { UserContext } from '@/domain/agent';

export function RoleSwitchFloat({ user }: { user: UserContext }) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  const canSwitch = user.role === 'teacher' || user.provider === 'preview';
  if (!canSwitch) return null;

  const teacherView = pathname.startsWith('/teacher');
  const targetPath = teacherView ? '/student' : '/teacher';
  const label = teacherView ? '学生端' : '教师端';

  async function handleSwitch() {
    if (busy) return;
    setBusy(true);
    try {
      if (user.provider === 'preview') {
        const res = await fetch('/api/preview/switch-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: teacherView ? 'student' : 'teacher' }),
        });
        if (!res.ok) throw new Error('switch failed');
      }
      router.push(targetPath);
      router.refresh();
    } catch {
      router.push(targetPath);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="role-switch-float"
      type="button"
      onClick={handleSwitch}
      disabled={busy}
      aria-label={`切换到${label}`}
    >
      <GraduationCap size={18} aria-hidden="true" />
      <span>{busy ? '切换中…' : label}</span>
    </button>
  );
}
