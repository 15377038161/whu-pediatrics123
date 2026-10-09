'use client';

/**
 * 客户端身份门控（新鉴权链路）：
 * - 会话在 localStorage（SDK 管理），SSR 无法读取 → 布局改为客户端门控；
 * - 挂载后经 authedFetch 调 /api/auth/me（携带 Authorization → 网关 x-sandbox-authorization），
 *   服务端 getUser() 网络校验后返回真实身份；
 * - 401：authedFetch 已清会话并跳登录页；角色不匹配：按角色跳转对应端。
 * - 本地直连场景：header 无 token 时服务端回退 cookie 会话（预览/本地 SSR 路径仍可用）。
 *
 * 角色规则：教师可访问学生端（双端），学生访问教师端跳回 /student。
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { UserContext } from '@/domain/agent';
import { authedFetch } from '@/lib/authed-api';
import { AppShell } from '@/components/app-shell';

const AuthGateContext = createContext<UserContext | null>(null);

/** 在门控内部获取当前用户（已通过 /api/auth/me 网络校验）。 */
export function useGateUser(): UserContext {
  const value = useContext(AuthGateContext);
  if (!value) throw new Error('useGateUser 必须在门控组件内使用');
  return value;
}

type GateState =
  | { phase: 'loading' }
  | { phase: 'ready'; user: UserContext }
  | { phase: 'blocked'; reason: string };

function useGateAuth(role: 'student' | 'teacher'): GateState {
  const [state, setState] = useState<GateState>({ phase: 'loading' });
  useEffect(() => {
    let cancelled = false;
    authedFetch<{ user: UserContext }>('/api/auth/me')
      .then(({ user }) => {
        if (cancelled) return;
        if (role === 'teacher' && user.role !== 'teacher') {
          window.location.assign('/student');
          return;
        }
        setState({ phase: 'ready', user });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // authedFetch 对 401 已清会话并跳登录页；此处兜底其余错误（网络/5xx）
        const message = error instanceof Error ? error.message : '身份校验失败';
        setState({ phase: 'blocked', reason: message });
      });
    return () => {
      cancelled = true;
    };
  }, [role]);
  return state;
}

function GateFallback({ state }: { state: GateState }) {
  const loading = state.phase === 'loading';
  return (
    <div className="app-frame">
      <main className="main-content" id="main-content">
        <div className="empty-state" role={loading ? 'status' : 'alert'}>
          <p>{loading ? '正在校验登录身份…' : `身份校验失败：${(state as { reason: string }).reason}`}</p>
          {!loading && <Link className="btn btn-primary" href="/">返回登录</Link>}
        </div>
      </main>
    </div>
  );
}

/**
 * 布局级门控 + AppShell 组合：
 * 布局（student/teacher layout）改为纯服务端薄壳，包裹本组件后由客户端完成
 * 「身份校验 → 角色路由 → 外壳渲染」全流程，子页面仍为静态/客户端内容。
 */
export function GatedAppShell({ role, children }: { role: 'student' | 'teacher'; children: ReactNode }) {
  const state = useGateAuth(role);
  if (state.phase !== 'ready') return <GateFallback state={state} />;
  return (
    <AuthGateContext.Provider value={state.user}>
      <AppShell user={state.user}>{children}</AppShell>
    </AuthGateContext.Provider>
  );
}

/** 不带 AppShell 的轻量门控（如 about/agent 教师导航页）。 */
export function AuthGate({ role, children }: { role?: 'student' | 'teacher'; children: ReactNode }) {
  const state = useGateAuth(role ?? 'student');
  if (state.phase !== 'ready') return <GateFallback state={state} />;
  return <AuthGateContext.Provider value={state.user}>{children}</AuthGateContext.Provider>;
}
