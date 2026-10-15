import Image from 'next/image';
import { HeartPulse, MessageCircleHeart, Sparkles, Stethoscope } from 'lucide-react';
import { LoginEntries } from '@/components/login-entries';

/**
 * 登录起始页（2026-10-14 按老师批注收敛）：
 * - 主标题发回原先的「练一次，会接诊」；删除介绍段与「儿童不是成人的缩影」段（排版与字体观感批注）；
 * - 登录面板直接提供 超星一键 + 邮箱密码登录，不再先选教师/学生入口卡；
 *   教师入口收敛为面板角落小按钮（组件内），入口意图不预授权角色，角色由服务端 /api/auth/me 判定；
 * - SSR 不做会话重定向（网关剥离 Cookie），已登录检测由 LoginEntries 挂载自愈完成。
 */
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
              <span className="welcome-chip"><HeartPulse size={15} /> 未来的小医生，你好</span>
              <h2>练一次，会接诊</h2>
            </div>
          </div>
          <div className="landing-trust"><span><Stethoscope size={15} /> 真实临床场景</span><span><MessageCircleHeart size={15} /> 临床思维训练</span><span><Sparkles size={15} /> 患儿与家庭关怀</span></div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <LoginEntries />
        </section>
      </div>
    </main>
  );
}
