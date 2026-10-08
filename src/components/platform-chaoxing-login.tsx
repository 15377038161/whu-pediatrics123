'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, ExternalLink } from 'lucide-react';
import {
  LOGIN_DIAG_VERSION,
  LoginStage,
  consumeNavigationAttempt,
  loginWithChaoxingOAuth,
} from '@/lib/chaoxing-oauth-client';

const STAGE_LABELS: Record<LoginStage, string> = {
  'fetch-start': '阶段1：正在请求登录服务',
  'fetch-network-error': '阶段1失败：网络层异常',
  'fetch-http-error': '阶段1失败：登录服务返回错误',
  'authorize-url-ok': '阶段2：已获取授权地址',
  'authorize-url-invalid': '阶段2失败：授权地址无效',
  'nav-assign': '阶段3：正在跳转超星授权页',
};

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
  const [stage, setStage] = useState<LoginStage | null>(null);
  const [stageDetail, setStageDetail] = useState('');

  useEffect(() => {
    const attempted = consumeNavigationAttempt();
    if (attempted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 一次性消费 sessionStorage 拦截标记（与 student/quiz 页初始外系统同步同模式）
      setBlockedUrl(attempted);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 同上：单次同步外部系统快照，无级联渲染
      setError('自动跳转超星登录页被当前浏览器环境拦截');
    }
  }, []);

  const login = async () => {
    setPending(true);
    setError('');
    setBlockedUrl('');
    setStage('fetch-start');
    setStageDetail('');
    const result = await loginWithChaoxingOAuth((s, detail) => {
      setStage(s);
      setStageDetail(detail || '');
    });
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
    <div className="chaoxing-login-entry" data-login-diag={LOGIN_DIAG_VERSION}>
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
      {stage && (
        <p className="login-stage" data-stage={stage} role="status">
          {STAGE_LABELS[stage]}
          {stageDetail ? `（${stageDetail}）` : ''}
        </p>
      )}
      {pending && stage === 'nav-assign' && (
        <p className="login-stage-hint">若 3 秒内未跳转且无变化，说明顶层导航被当前浏览器环境拦截</p>
      )}
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
