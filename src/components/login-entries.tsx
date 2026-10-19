'use client';

/** 入口选择只影响登录落点，教师身份仍由服务端校验。 */

import { useCallback, useEffect, useState } from 'react';
import { PlatformChaoxingLogin } from '@/components/platform-chaoxing-login';
import {
  clearLoginEntry,
  type EntryRole,
  readLoginEntry,
  routeAfterLogin,
  setLoginEntry,
  translateAuthError,
} from '@/lib/login-entry';
import { getBrowserSession, getBrowserSupabase } from '@/lib/supabase-browser';

interface MeResponse {
  ok?: boolean;
  data?: { user?: { role?: string } };
}

export function LoginEntries() {
  const [entryRole, setEntryRole] = useState<EntryRole>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  const resolveRouting = useCallback((role: string) => {
    const routing = routeAfterLogin(role, readLoginEntry());
    if (routing.denied) {
      // 学生身份 + 教师入口意图：清除意图并按实际角色跳转学生工作台
      //（教师端另有服务端守卫兜底；原地提示在 OAuth 回跳整页重载后不可见，已实证为体验断点）。
      clearLoginEntry();
      window.location.assign('/student');
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

  const selectEntry = (role: EntryRole) => {
    setError('');
    setEntryRole(role);
    setLoginEntry(role);
  };

  const submitPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setLoginEntry(entryRole);
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

  return (
    <div className="login-entry-panel" aria-busy={checking}>
      <h2 className="section-title" id="login-title">欢迎登录</h2>
      <div className="login-role-switch" role="group" aria-label="登录入口">
        {(['student', 'teacher'] as const).map((role) => (
          <button key={role} type="button" aria-pressed={entryRole === role}
            disabled={pending} onClick={() => selectEntry(role)}>
            {role === 'student' ? '学生端' : '教师端'}
          </button>
        ))}
      </div>
      <div className="login-actions">
        <PlatformChaoxingLogin entryRole={entryRole} onPendingChange={setPending} />
        <details className="login-email-option">
          <summary>使用邮箱密码登录</summary>
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
        </details>
      </div>
      <p className="login-footnote">仅用于教学训练</p>
    </div>
  );
}
