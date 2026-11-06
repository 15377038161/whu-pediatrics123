'use client';

import { BarChart3, BookOpenCheck, BookOpenText, ClipboardCheck, GraduationCap, Home, LibraryBig, LogOut, MonitorPlay, MoreHorizontal, Sparkles, Trophy, Users } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { UserContext } from '@/domain/agent';

const studentNav = [
  { href: '/student', label: '首页', icon: Home, primary: true },
  { href: '/student/practice', label: '临床能力专项', icon: Sparkles, primary: true },
  { href: '/student/quiz', label: '知识点回顾', icon: BookOpenCheck, primary: true },
  { href: '/student/reports', label: '报告', icon: BarChart3, primary: true },
  { href: '/student/classes', label: '排行榜', icon: Trophy, primary: false },
  { href: '/student/osce', label: 'OSCE', icon: ClipboardCheck, primary: false },
  { href: '/student/skills', label: '技能学习', icon: GraduationCap, primary: false },
  { href: '/student/resources', label: '教学视频', icon: MonitorPlay, primary: false },
];

const teacherNav = [
  { href: '/teacher', label: '学生学情', icon: Users, primary: true },
  { href: '/teacher/classes', label: '班级管理', icon: Users, primary: true },
  { href: '/teacher/question-banks', label: '题集管理', icon: LibraryBig, primary: true },
  { href: '/teacher/skill-assessments', label: '现场考核', icon: ClipboardCheck, primary: true },
  { href: '/teacher/resources', label: '资源中心', icon: MonitorPlay, primary: false },
  { href: '/teacher/usage-stats', label: '使用统计', icon: BarChart3, primary: false },
  { href: '/teacher/case-drafts', label: '病例草稿', icon: BookOpenCheck, primary: false },
  { href: '/about/agent', label: '智能体说明', icon: BookOpenText, primary: false },
];

export function AppShell({ user, children }: { user: UserContext; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const teacherView = pathname.startsWith('/teacher');
  const nav = teacherView ? teacherNav : studentNav;
  const moreItems = nav.filter((item) => !item.primary);
  const moreActive = moreItems.some(({ href }) => pathname.startsWith(href));

  useEffect(() => {
    const closeMore = () => setMoreOpen(false);
    window.addEventListener('popstate', closeMore);
    return () => window.removeEventListener('popstate', closeMore);
  }, []);
  useEffect(() => {
    if (!moreOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMoreOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moreOpen]);

  if (pathname.startsWith('/student/training')) return <>{children}</>;

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

  function linkActive(href: string) {
    const target = href.split('?')[0];
    const root = teacherView ? '/teacher' : '/student';
    return target === root ? pathname === target : pathname.startsWith(target);
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
        {nav.map(({ href, label, icon: Icon, primary }) => {
          const active = linkActive(href);
          return (
            <a
              key={href}
              href={href}
              data-active={active}
              data-mobile-primary={primary}
              data-long={label.length > 4}
            >
              <Icon aria-hidden="true" /> <span>{label}</span>
            </a>
          );
        })}
        <button
          className="bottom-nav-more"
          type="button"
          data-active={moreActive}
          aria-expanded={moreOpen}
          aria-controls="mobile-more-nav"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal aria-hidden="true" /> <span>更多</span>
        </button>
      </nav>
      {moreOpen && (
        <>
          <button className="bottom-nav-scrim" type="button" aria-label="关闭更多入口" onClick={() => setMoreOpen(false)} />
          <div className="bottom-nav-sheet" id="mobile-more-nav" role="dialog" aria-label="更多入口">
            <div className="bottom-nav-sheet-head"><strong>更多</strong><button type="button" onClick={() => setMoreOpen(false)}>关闭</button></div>
            <div className="bottom-nav-sheet-grid">
              {moreItems.map(({ href, label, icon: Icon }) => (
                <a key={href} href={href} data-active={linkActive(href)} onClick={() => setMoreOpen(false)}>
                  <Icon aria-hidden="true" /> <span>{label}</span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
