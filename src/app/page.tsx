import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowRight, GraduationCap, ShieldCheck } from 'lucide-react';
import { getCurrentUser } from '@/lib/supabase-auth';
import { isPreviewEnabled } from '@/lib/preview-auth';

export default async function LoginPage() {
  const user = await getCurrentUser(await cookies());
  if (user) redirect(user.role === 'teacher' ? '/teacher' : '/student');
  const preview = isPreviewEnabled();
  const authReady = process.env.ENABLE_CHAOXING_AUTH === 'true' && Boolean(process.env.CHAOXING_APPID && process.env.CHAOXING_SECRET);
  return (
    <main className="landing" id="main-content">
      <video className="landing-media" autoPlay muted loop playsInline poster="/media/luojia-pediatrics-poster.svg" aria-hidden="true">
        <source src="/media/luojia-pediatrics-loop.webm" type="video/webm" />
        <source src="/media/luojia-pediatrics-loop.mp4" type="video/mp4" />
      </video>
      <div className="landing-shade" />
      <div className="landing-content">
        <section>
          <div className="brand-lockup">
            <div className="brand-seal" aria-hidden="true">珞珈</div>
            <div>
              <h1 className="brand-name">珞珈儿科智训</h1>
              <p className="brand-kicker">Wuhan University Pediatrics</p>
            </div>
          </div>
          <div className="landing-copy">
            <h2>从真实问诊，到可解释的临床能力成长</h2>
            <p>在同一个病例记忆中完成自主问诊、可视化查体、临床决策、家长沟通与 OSCE 考核。</p>
          </div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <p className="eyebrow">统一身份入口</p>
          <h2 className="section-title" id="login-title">进入儿科临床学习空间</h2>
          <div className="login-status">
            <span className="status-dot" aria-hidden="true" />
            <span>{authReady ? '超星认证配置已载入，首次正式联调后启用。' : '管理员尚未完成超星身份授权；正式环境不会开放替代登录。'}</span>
          </div>
          <div className="login-actions">
            <a className="btn btn-primary btn-block" href="/api/auth/chaoxing">
              <GraduationCap size={19} /> 使用超星账号进入 <ArrowRight size={17} />
            </a>
            {preview && (
              <>
                <a className="btn btn-secondary btn-block" href="/api/preview/login?role=student">评委预览 · 学生端</a>
                <a className="btn btn-quiet btn-block" href="/api/preview/login?role=teacher">评委预览 · 教师只读端</a>
              </>
            )}
          </div>
          <p className="login-note"><ShieldCheck size={13} style={{ verticalAlign: -2 }} /> 授权令牌仅在服务端交换，不进入浏览器、日志或交付包。</p>
        </section>
      </div>
    </main>
  );
}
