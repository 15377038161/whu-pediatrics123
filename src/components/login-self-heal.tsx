'use client';

/**
 * 登录页客户端自愈：
 * OAuth 成功后 SDK 会话落在 localStorage（网关剥离 Cookie，服务端 SSR 读不到），
 * OAuthCallbackHandler 跳回 '/' 时服务端无法重定向 → 由本组件检测 SDK 会话，
 * 经 /api/auth/me 网络校验身份后按角色跳转（学生 /student、教师 /teacher）。
 * 无会话/已过期则静默留在登录页（正常未登录状态）。
 */

import { useEffect } from 'react';
import { getBrowserSession } from '@/lib/supabase-browser';
import { getBrowserSupabase } from '@/lib/supabase-browser';

export function LoginSelfHeal() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getBrowserSession();
      if (cancelled || !session) return;
      // 有本地会话：网络校验并取角色（token 不落日志）
      const { data } = await getBrowserSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const resp = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      });
      const body = (await resp.json().catch(() => null)) as { ok?: boolean; data?: { user?: { role?: string } } } | null;
      if (cancelled || !body?.ok || !body.data?.user) return;
      window.location.assign(body.data.user.role === 'teacher' ? '/teacher' : '/student');
    })().catch(() => {
      // 自愈失败（网络异常等）：留在登录页，用户可重新发起 OAuth
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
