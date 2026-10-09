'use client';

/**
 * 双端登录入口（登录入口升级）：
 * - 起始页两张独立显眼入口卡（教师端 / 学生端）；
 * - 选择入口后进入登录面板：一键超星登录 或 邮箱密码登录（Auth 配置 external_email_enabled=true）；
 * - 入口选择只记录登录落点意图（sessionStorage，见 login-entry.ts），绝不预授权角色；
 *   角色一律由服务端 /api/auth/me 按真实身份（超星白名单 / app_metadata）判定；
 * - 学生身份走教师端入口 → 拒绝进入并提示改走学生端（教师页面另有服务端守卫兜底）；
 * - 挂载自愈（原 LoginSelfHeal 行为）：检测 SDK 会话 → 网络校验 → 按角色+意图路由。
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpenCheck, GraduationCap } from 'lucide-react';
import { PlatformChaoxingLogin } from '@/components/platform-chaoxing-login';
import {
  clearLoginEntry,
  readLoginEntry,
  routeAfterLogin,
  setLoginEntry,
  translateAuthError,
  type EntryRole,
} from '@/lib/login-entry';
import { getBrowserSession, getBrowserSupabase } from '@/lib/supabase-browser';

interface MeResponse {
  ok?: boolean;
  data?: { user?: { role?: string } };
}

export function LoginEntries() {
  const [entry, setEntry] = useState<EntryRole | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [checking, setChecking] = useState(true);

  const resolveRouting = useCallback((role: string) => {
    const routing = routeAfterLogin(role, readLoginEntry());
    if (routing.denied) {
      // 学生身份 + 教师端入口：拒绝进入教师端，留在登录页提示
      setDenied(true);
      setChecking(false);
      return;
    }
    if (routing.path) window.location.assign(routing.path);
  }, []);

  // 挂载自愈：已有会话（OAuth 回跳/已登录）→ 网络校验后按角色+入口意图路由
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getBrowserSession();
        if (!session) {
          setChecking(false);
          return;
        }
        const resp = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
        });
        const body = (await resp.json().catch(() => null)) as MeResponse | null;
        if (cancelled || !body?.ok || !body.data?.user) {
          setChecking(false);
          return;
        }
        resolveRouting(body.data.user.role ?? 'student');
      } catch {
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveRouting]);

  const chooseEntry = (role: EntryRole) => {
    setEntry(role);
    setDenied(false);
    setError('');
    setLoginEntry(role);
  };

  const backToSelection = () => {
    setEntry(null);
    setDenied(false);
    setError('');
    clearLoginEntry();
  };

  const submitPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const { data, error: authError } = await getBrowserSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError || !data.session) {
        setError(translateAuthError(authError?.message));
        setPending(false);
        return;
      }
      // 登录成功：网络校验身份并按角色+入口意图路由（成功分支不复位表单状态）
      const resp = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json' },
      });
      const body = (await resp.json().catch(() => null)) as MeResponse | null;
      if (!body?.ok || !body.data?.user) {
        setError('登录成功但身份校验失败，请重试');
        setPending(false);
        return;
      }
      resolveRouting(body.data.user.role ?? 'student');
    } catch {
      setError(translateAuthError(undefined));
      setPending(false);
    }
  };

  if (entry === null) {
    return (
      <div className="login-entries" aria-busy={checking}>
        <h2 className="section-title" id="login-title">选择你的身份入口</h2>
        <p className="login-entries-lead">教师与学生分别进入专属工作台，登录后系统将按真实身份自动校验权限。</p>
        <div className="login-entry-grid">
          <button type="button" className="login-entry-card login-entry-card-teacher" onClick={() => chooseEntry('teacher')}>
            <span className="login-entry-icon"><GraduationCap size={26} aria-hidden="true" /></span>
            <span className="login-entry-title">教师端入口</span>
            <span className="login-entry-desc">学情统计 · 病例管理 · 审核导入</span>
            <span className="login-entry-arrow"><ArrowRight size={16} aria-hidden="true" /></span>
          </button>
          <button type="button" className="login-entry-card login-entry-card-student" onClick={() => chooseEntry('student')}>
            <span className="login-entry-icon"><BookOpenCheck size={26} aria-hidden="true" /></span>
            <span className="login-entry-title">学生端入口</span>
            <span className="login-entry-desc">临床训练 · OSCE · 题库 · 报告</span>
            <span className="login-entry-arrow"><ArrowRight size={16} aria-hidden="true" /></span>
          </button>
        </div>
      </div>
    );
  }

  const isTeacher = entry === 'teacher';
  return (
    <div className="login-entry-panel">
      <button type="button" className="login-entry-back" onClick={backToSelection}>
        <ArrowLeft size={15} aria-hidden="true" />
        返回选择入口
      </button>
      <h2 className="section-title" id="login-title">{isTeacher ? '教师端登录' : '学生端登录'}</h2>
      <p className="login-entry-hint">
        {isTeacher ? '教师权限将按真实身份与白名单校验，非授权账号无法进入。' : '使用超星账号一键进入，或使用邮箱密码登录。'}
      </p>
      {denied && (
        <p className="login-error" role="alert">
          当前账号为学生身份，无法从教师端入口进入。请返回并选择学生端入口。
        </p>
      )}
      <div className="login-actions">
        <PlatformChaoxingLogin />
        <div className="login-divider" aria-hidden="true"><span>或使用邮箱密码登录</span></div>
        <form className="login-form" onSubmit={submitPassword}>
          <label className="login-field">
            邮箱
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="login-field">
            密码
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              minLength={6}
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="btn btn-secondary btn-block" type="submit" disabled={pending}>
            {pending ? '正在登录…' : '邮箱密码登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
