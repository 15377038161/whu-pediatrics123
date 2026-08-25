import Link from 'next/link';

const messages: Record<string, { title: string; detail: string }> = {
  config_missing: { title: '超星身份授权尚未配置', detail: '请项目管理员完成APPID、APPKEY、学校FID和HTTPS回调地址配置后再试。' },
  institution_mismatch: { title: '当前账号不属于允许机构', detail: '请确认使用武汉大学所属账号登录，或联系管理员核对学校FID。' },
  oauth_failed: { title: '超星授权未完成', detail: '授权码可能已过期或被使用，请返回后重新发起登录。' },
  oauth_expired: { title: '登录请求已过期', detail: '为保护账号安全，本次登录上下文已失效，请返回登录页重新发起授权。' },
  session_failed: { title: '登录会话建立失败', detail: '超星身份已返回，但本项目数据库会话尚未建立，请稍后重试。' },
};

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason = 'oauth_failed' } = await searchParams;
  const message = messages[reason] ?? messages.oauth_failed;
  return (
    <main className="auth-error-page">
      <section className="auth-error-card">
        <span className="auth-error-mark">!</span>
        <p className="eyebrow">LUOJIA PEDIATRICS · IDENTITY</p>
        <h1>{message.title}</h1>
        <p>{message.detail}</p>
        <div className="button-row">
          <Link className="button primary" href="/">返回登录页</Link>
          <a className="button ghost" href="/api/auth/chaoxing">重新登录</a>
        </div>
      </section>
    </main>
  );
}
