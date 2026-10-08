'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, ExternalLink } from 'lucide-react';
import {
  consumeNavigationAttempt,
  loginWithChaoxingOAuth,
} from '@/lib/chaoxing-oauth-client';

/**
 * 平台内置超星 OAuth 主登录入口（官方契约：authorize-url → checklogin 中转 → exchange）。
 * 凭证全在平台服务端，无需应用配置 CHAOXING_APPID/SECRET。
 *
 * 跳转被拦截兜底：login 在 assign 前写入 sessionStorage 标记；若导航被内置浏览器拦截
 * 导致页面重载回本站，挂载时消费标记并显示「手动打开超星登录页」新窗口链接，
 * 绝不静默恢复按钮让用户无从判断。
 */
export function PlatformChaoxingLogin() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [blockedUrl, setBlockedUrl] = useState('');

  useEffect(() => {
    const attempted = consumeNavigationAttempt();
    if (attempted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 一次性消费 sessionStorage 拦截标记（与 student/quiz 页初始外系统同步同模式）
      setBlockedUrl(attempted);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 同上
      setError('自动跳转超星登录页被当前浏览器环境拦截');
    }
  }, []);

  const login = async () => {
    setPending(true);
    setError('');
    setBlockedUrl('');
    const result = await loginWithChaoxingOAuth();
    if (!result.success) {
      setError(result.error || '跳转授权页失败');
      setPending(false);
    }
    // 成功分支：页面即将顶层跳转到超星授权页，无需复位
  };

  const openManually = () => {
    if (blockedUrl) window.open(blockedUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="chaoxing-login-entry">
      <button
        className="btn btn-primary btn-block"
        type="button"
        onClick={login}
        disabled={pending}
      >
        <Image className="chaoxing-mark" src="/media/brand/chaoxing-logo.png" alt="" width={135} height={135} />
        {pending ? '正在连接超星…' : '使用超星账号进入'}
        {!pending && <ArrowRight size={17} />}
      </button>
      {error && <p className="login-error" role="alert">{error}</p>}
      {blockedUrl && (
        <button
          type="button"
          className="btn btn-quiet btn-block"
          onClick={openManually}
        >
          <ExternalLink size={16} />
          手动打开超星登录页
        </button>
      )}
    </div>
  );
}
