'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { loginWithChaoxingOAuth } from '@/lib/chaoxing-oauth-client';

/**
 * 平台内置超星 OAuth 主登录入口（官方契约：authorize-url → checklogin 中转 → exchange）。
 * 凭证全在平台服务端，无需应用配置 CHAOXING_APPID/SECRET。
 */
export function PlatformChaoxingLogin() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const login = async () => {
    setPending(true);
    setError('');
    const result = await loginWithChaoxingOAuth();
    if (!result.success) {
      setError(result.error || '跳转授权页失败');
      setPending(false);
    }
    // 成功分支：页面即将顶层跳转到超星授权页，无需复位
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
    </div>
  );
}
