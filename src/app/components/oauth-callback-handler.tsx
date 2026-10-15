'use client';

import { useEffect } from 'react';
import { handleOAuthLoginFlow } from '@/lib/chaoxing-oauth-client';

/**
 * 平台超星 OAuth 登录闭环组件：挂 root layout（body 直接子层级），
 * 任意路由的回跳落点都会执行闭环（checklogin 中转 + exchange）。
 * 内部 exchange 自带 in-flight 去重，StrictMode 双执行也只发一次。
 * 登录成功后导航回根路径：root 为客户端渲染的登录页（网关剥离 Cookie，SSR 不做会话重定向），
 * 由 LoginEntries 挂载自愈（SDK 会话 → /api/auth/me 网络校验 → 按角色+入口意图路由）完成落点跳转；
 * 学生身份误走教师端入口时同样按角色跳转 /student（教师端另有服务端守卫兜底）。
 */
export function OAuthCallbackHandler() {
  useEffect(() => {
    let cancelled = false;
    handleOAuthLoginFlow().then((result) => {
      if (cancelled) return;
      if (result.success) {
        // 登录成功：刷新到根路径，由服务端页面按角色重定向（学生 /student、教师 /teacher）
        window.location.assign('/');
      } else if (result.error) {
        console.warn('[auth] 平台 OAuth 回跳处理失败:', result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
