'use client';

import { useEffect } from 'react';

/**
 * 根布局级全局错误边界（插查-H1 机制收口，补齐 error.tsx 之外的最后一段）：
 * - error.tsx 只能捕获组件树内的客户端异常；root layout 自身抛错或 html/body 层
 *   hydration 崩溃时 error.tsx 接不住，仍会整页白屏——global-error 是 Next.js App Router
 *   该层级的唯一捕获点（规范要求自带 <html>/<body>，根布局 CSS 可能未加载）。
 * - 与 error.tsx 同一取证模式：异常原文与堆栈经 console.error 输出（浏览器控制台可见、
 *   预览页由平台自动采集），下次发生任何层级白屏均可拿到第一手错误信息。
 * - 核心可读性以内联样式保证（不依赖可能未加载的 globals.css）；不假设根因、
 *   不改动任何权限/数据/业务逻辑；训练进度已由服务端持久化，重试/返回不丢数据。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[client-exception:global]', error?.message ?? 'unknown', error?.digest ? `digest=${error.digest}` : '', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f7fbf8',
          color: '#20332c',
          fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        <main role="alert" style={{ maxWidth: 520, textAlign: 'center' }}>
          <div
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              margin: '0 auto 16px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#e7f2ec',
              color: '#2f6b52',
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            !
          </div>
          <strong style={{ fontSize: 18 }}>页面出了点问题</strong>
          <p style={{ marginTop: 10, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
            {error?.message || '发生未知错误，你的训练进度已在服务器保存。'}
          </p>
          {error?.digest ? (
            <p style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>错误标识：{error.digest}</p>
          ) : null}
          <p style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: 40,
                padding: '10px 20px',
                borderRadius: 10,
                border: 'none',
                background: '#2f6b52',
                color: '#fff',
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
            <a
              href="/student"
              style={{
                minHeight: 40,
                padding: '10px 20px',
                borderRadius: 10,
                border: '1px solid #cfdcd5',
                background: '#fff',
                color: '#20332c',
                fontSize: 15,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              返回首页
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
