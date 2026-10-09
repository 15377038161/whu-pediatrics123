import Image from 'next/image';
import { HeartPulse, MessageCircleHeart, Sparkles, Stethoscope } from 'lucide-react';
import { LoginEntries } from '@/components/login-entries';

/**
 * 登录起始页（登录入口升级）：
 * - 独立显眼的双端入口：教师端入口 / 学生端入口（组件内选择后进入登录面板）；
 * - 登录面板自主选择：一键超星登录 或 邮箱密码登录（Auth 配置 external_email_enabled=true）；
 * - 入口选择不预授权角色：角色由服务端 /api/auth/me 按真实身份（超星白名单/app_metadata）判定；
 * - 旧平行入口（评委预览直链）与旧单按钮登录面板已按需求移除；
 * - SSR 不做会话重定向（网关剥离 Cookie），已登录检测由 LoginEntries 挂载自愈完成。
 */
export default function LoginPage() {
  return (
    <main className="landing" id="main-content">
      <div className="landing-scene" aria-hidden="true">
        <span className="scene-orb scene-orb-one" />
        <span className="scene-orb scene-orb-two" />
        <span className="luojia-silhouette" />
        <div className="landing-ecg">
          <svg viewBox="0 0 1440 220" preserveAspectRatio="none">
            <path className="landing-ecg-ghost" d="M0 116H188l28-1 18-29 22 76 24-120 28 73h166l25-1 17-25 21 66 25-103 27 63h224l27-1 18-31 23 82 27-128 30 77h282" />
            <path className="landing-ecg-line" d="M0 116H188l28-1 18-29 22 76 24-120 28 73h166l25-1 17-25 21 66 25-103 27 63h224l27-1 18-31 23 82 27-128 30 77h282" />
          </svg>
        </div>
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
              <span className="welcome-chip"><HeartPulse size={15} /> 未来的小医生，你好</span>
              <h2>练一次，会接诊</h2>
              <p>和虚拟患儿、家长对话，完成一场真实感儿科训练。</p>
            </div>
          </div>
          <div className="landing-trust"><span><Stethoscope size={15} /> 真实临床动线</span><span><MessageCircleHeart size={15} /> 患儿与家长双角色</span><span><Sparkles size={15} /> 每一步都有证据</span></div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <span className="login-panel-icon"><Stethoscope size={21} /></span>
          <LoginEntries />
          <p className="login-footnote">教学模拟 · 非真实医疗建议</p>
        </section>
      </div>
    </main>
  );
}
