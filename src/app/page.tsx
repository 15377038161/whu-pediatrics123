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
              <p className="brand-kicker">Wuhan University Pediatrics</p>
            </div>
          </div>
          <div className="landing-hero-row">
            <div className="landing-copy">
              <h2>练一次，会接诊</h2>
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
