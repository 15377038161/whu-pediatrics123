'use client';

/**
 * 登录面板（2026-10-14 按老师批注收敛 + 回跳跳转修复）：
 * - 取消「教师/学生双入口卡」两步选择流程：面板直接提供 超星一键登录 + 邮箱密码登录；
 * - 教师入口收敛为面板右上角小按钮：仅记录落点意图（sessionStorage，见 login-entry.ts），
 *   绝不预授权角色；角色一律由服务端 /api/auth/me 按真实身份（超星白名单 / app_metadata）判定；
 * - 学生身份点教师入口登录 → 清除教师意图并按实际角色跳转学生工作台（登录闭环不原地停留；
 *   OAuth 回跳整页重载后停留 root 无任何提示已实证为体验断点；教师端另有服务端守卫兜底）；
 * - 挂载自愈（原 LoginSelfHeal 行为）：检测 SDK 会话 → 网络校验 → 按角色+意图路由。
 */

import { useCallback, useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { PlatformChaoxingLogin } from '@/components/platform-chaoxing-login';
import {
  clearLoginEntry,
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

  const enterAsTeacher = () => {
    setError('');
    setLoginEntry('teacher');
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

  return (
    <div className="login-entry-panel" aria-busy={checking}>
      <div className="login-panel-head">
        <h2 className="section-title" id="login-title">登录</h2>
        <button type="button" className="login-teacher-corner" onClick={enterAsTeacher} title="教师以超星白名单账号或教师邮箱密码登录">
          <GraduationCap size={14} aria-hidden="true" />
          教师入口
        </button>
      </div>
      <p className="login-entry-hint">默认按学生身份登录；教师请先点右上角「教师入口」。</p>
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
      <p className="login-footnote">教学模拟 · 非真实医疗建议 · 教学表述依据《儿科学》第10版</p>
    </div>
  );
}
