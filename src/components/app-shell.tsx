'use client';

import { BarChart3, BookOpenCheck, BookOpenText, ClipboardCheck, Home, LibraryBig, LogOut, Sparkles, Users } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { UserContext } from '@/domain/agent';

const studentNav = [
  { href: '/student', label: '首页', icon: Home },
  { href: '/student/practice', label: '专项', icon: Sparkles },
  { href: '/student/osce', label: 'OSCE', icon: ClipboardCheck },
  { href: '/student/quiz', label: '题库', icon: BookOpenCheck },
  { href: '/student/reports', label: '报告', icon: BarChart3 },
];

const teacherNav = [
  { href: '/teacher', label: '学生学情', icon: Users },
  { href: '/teacher/classes', label: '班级管理', icon: Users },
  { href: '/teacher/question-banks', label: '题集管理', icon: LibraryBig },
  { href: '/teacher/usage-stats', label: '使用统计', icon: BarChart3 },
  { href: '/teacher/case-drafts', label: '病例草稿', icon: BookOpenCheck },
  { href: '/about/agent', label: '智能体说明', icon: BookOpenText },
];

export function AppShell({ user, children }: { user: UserContext; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [avatarFailed, setAvatarFailed] = useState(false);
  if (pathname.startsWith('/student/training')) return <>{children}</>;
  const teacherView = pathname.startsWith('/teacher');
  const nav = teacherView ? teacherNav : studentNav;
  async function logout() {
    if (user.provider === 'preview') {
      await fetch('/api/auth/logout', { method: 'POST' });
    } else {
      // 真实会话在 localStorage（SDK 管理）：SDK 全局吊销 + 本地清除；网关域下 cookie 不可达
      try {
        const { signOutBrowserSession } = await import('@/lib/supabase-browser');
        await signOutBrowserSession();
      } catch {
        // 吊销失败仍强制清本地会话跳登录
      }
    }
    router.replace('/');
    router.refresh();
  }
  return (
    <div className="app-frame" data-view={teacherView ? 'teacher' : 'student'}>
      <header className="topbar">
        <a className="topbar-brand" href={teacherView ? '/teacher' : '/student'}>
          <span className="mini-seal" aria-hidden="true">珞珈</span>
          <span>儿科智训</span>
        </a>
        <div className="topbar-user">
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
        {nav.map(({ href, label, icon: Icon }) => {
          const target = href.split('?')[0];
          const active = target === (teacherView ? '/teacher' : '/student') ? pathname === target : pathname.startsWith(target);
          return <a key={href} href={href} data-active={active}><Icon aria-hidden="true" /> <span>{label}</span></a>;
        })}
      </nav>
    </div>
  );
}
