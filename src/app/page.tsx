import Image from 'next/image';
import { LoginEntries } from '@/components/login-entries';

/** 会话在客户端网络校验，入口选择不授予角色。 */
export default function LoginPage() {
  return (
    <main className="landing" id="main-content">
      <div className="landing-scene" aria-hidden="true">
        <Image className="landing-photo" src="/login-bg.webp" alt="" fill priority sizes="100vw" />
        <span className="landing-photo-veil" />
      </div>
      <div className="landing-content">
        <section className="landing-intro">
          <div className="brand-lockup">
            <Image className="brand-logo" src="/media/brand/wuhan-university-logo.png" alt="武汉大学校徽" width={1796} height={1795} priority sizes="64px" />
            <div>
              <h1 className="brand-name">珞珈儿科智训</h1>
              <p className="brand-kicker">Luojia Pediatric Intelligent Training</p>
              <p className="brand-kicker">Wuhan University Pediatrics</p>
            </div>
          </div>
          <div className="landing-hero-row">
            <div className="landing-copy">
              <p className="landing-motto">大医精诚敬畏生命</p>
              <p>从 12 个儿科系统进入病例，完成问诊、查体、诊断与沟通训练；每次接诊保留可回放的证据与反馈。</p>
            </div>
          </div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <LoginEntries />
        </section>
      </div>
    </main>
  );
}
