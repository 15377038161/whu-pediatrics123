'use client';

import { useEffect } from 'react';

/**
 * 根级客户端错误边界（插查-H1 最小修正）：
 * - 背景：正式站曾出现点击病例后整页白屏（client-side exception）。全项目此前无任何
 *   error boundary，未捕获的渲染异常在 Next.js App Router 生产模式下表现为纯白屏——
 *   无错误信息、无恢复出口，也无从取证。
 * - 本边界不假设根因（具体崩溃点仍待用户补充浏览器 console 栈）：仅把未捕获异常转为
 *   可见错误态——展示异常消息与 digest 标识，提供「重试」与「返回首页」出口；异常原文
 *   与堆栈经 console.error 输出（浏览器控制台可直接查看，预览页控制台由平台自动采集），
 *   下次发生即可拿到第一手错误信息。
 * - 不改动任何权限、数据与业务逻辑；训练会话已由服务端持久化，重试/返回不丢进度。
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[client-exception]', error?.message ?? 'unknown', error?.digest ? `digest=${error.digest}` : '', error);
  }, [error]);

  return (
    <main className="loading-screen" role="alert">
      <div>
        <div className="pulse-mark">!</div>
        <strong>页面出了点问题</strong>
        <p style={{ marginTop: 10 }}>{error?.message || '发生未知错误，你的训练进度已在服务器保存。'}</p>
        {error?.digest ? <p style={{ fontSize: 12, opacity: 0.7 }}>错误标识：{error.digest}</p> : null}
        <p style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => reset()}>重试</button>
          <a className="btn btn-secondary" href="/student">返回首页</a>
        </p>
      </div>
    </main>
  );
}
