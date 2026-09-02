'use client';

import { BarChart3, BookOpenText, ClipboardCheck, GraduationCap, Home, LogOut, Sparkles, Users } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { UserContext } from '@/domain/agent';
import { RoleSwitchFloat } from '@/components/role-switch-float';

const studentNav = [
  { href: '/student', label: '首页', icon: Home },
  { href: '/student/practice', label: '专项', icon: Sparkles },
  { href: '/student/osce', label: 'OSCE', icon: ClipboardCheck },
  { href: '/student/reports', label: '报告', icon: BarChart3 },
];

const teacherNav = [
  { href: '/teacher', label: '学生学情', icon: Users },
  { href: '/about/agent', label: '智能体说明', icon: BookOpenText },
];

export function AppShell({ user, children }: { user: UserContext; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);
  if (pathname.startsWith('/student/training')) return <>{children}<RoleSwitchFloat user={user} /></>;
  const teacherView = pathname.startsWith('/teacher');
  const canSwitch = user.role === 'teacher' || user.provider === 'preview';
  const switchLabel = teacherView ? '学生端' : '教师端';
  const switchTarget = teacherView ? '/student' : '/teacher';
  const viewSwitch = canSwitch
    ? { href: switchTarget, label: switchLabel, icon: GraduationCap, switchView: true }
    : null;
  const nav = [...(teacherView ? teacherNav : studentNav), ...(viewSwitch ? [viewSwitch] : [])];
  async function handleSwitch() {
    if (switchBusy) return;
    setSwitchBusy(true);
    try {
      if (user.provider === 'preview') {
        const res = await fetch('/api/preview/switch-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: teacherView ? 'student' : 'teacher' }),
        });
        if (!res.ok) throw new Error('switch failed');
      }
      router.push(switchTarget);
      router.refresh();
    } catch {
      router.push(switchTarget);
    } finally {
      setSwitchBusy(false);
    }
  }
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
    router.refresh();
  }
  return (
    <div className="app-frame">
      <header className="topbar">
        <a className="topbar-brand" href={teacherView ? '/teacher' : '/student'}>
          <span className="mini-seal" aria-hidden="true">珞珈</span>
          <span>儿科智训</span>
        </a>
        <div className="topbar-user">
          {canSwitch && (
            user.role === 'teacher' ? (
              <a className="role-switch" href={switchTarget} aria-label={`切换到${switchLabel}`}><GraduationCap size={15} /><span>{switchLabel}</span></a>
            ) : (
              <button className="role-switch" type="button" onClick={handleSwitch} disabled={switchBusy} aria-label={`切换到${switchLabel}`}><GraduationCap size={15} /><span>{switchBusy ? '切换中…' : switchLabel}</span></button>
            )
          )}
          <div><strong>{user.displayName}</strong><span className="sr-only">，{user.role === 'teacher' ? '教师' : '学生'}</span></div>
          <div className="avatar" aria-label={`${user.displayName}的头像`}>
            {user.avatarUrl && !avatarFailed
              ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />
              : <span aria-hidden="true">{user.displayName.slice(0, 1)}</span>}
          </div>
          <button className="icon-btn" type="button" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={17} /></button>
        </div>
      </header>
      <main className="main-content" id="main-content">{children}</main>
      <nav className="bottom-nav" data-items={nav.length} aria-label="主要导航">
        {nav.map(({ href, label, icon: Icon, ...item }) => {
          const target = href.split('?')[0];
          const active = target === (teacherView ? '/teacher' : '/student') ? pathname === target : pathname.startsWith(target);
          return <a key={href} href={href} data-active={active} data-view-switch={'switchView' in item}><Icon aria-hidden="true" /> <span>{label}</span></a>;
        })}
      </nav>
    </div>
  );
}
