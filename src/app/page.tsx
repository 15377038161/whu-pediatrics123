import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import { Activity, ArrowRight, HeartPulse, MessageCircleHeart, Sparkles, Stethoscope } from 'lucide-react';
import { ChaoxingLoginEntry } from '@/components/chaoxing-login-entry';
import { getChaoxingLoginOptions } from '@/lib/chaoxing-client';
import { getCurrentUser } from '@/lib/supabase-auth';
import { isPreviewEnabled } from '@/lib/preview-auth';

export default async function LoginPage() {
  const user = await getCurrentUser(await cookies());
  if (user) redirect(user.role === 'teacher' ? '/teacher' : '/student');
  const preview = isPreviewEnabled();
  const loginOptions = getChaoxingLoginOptions();
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
          <span className="landing-ecg-pulse" />
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
              <div className="landing-status"><Activity size={15} /><span>教学智能体在线</span><i /><strong>108</strong> bpm</div>
            </div>
            <div className="landing-doctor" aria-hidden="true">
              <span className="doctor-speech">一起接诊吧！</span>
              <Image src="/media/brand/pediatric-mascot-v2.webp" alt="" width={760} height={777} priority sizes="(max-width: 699px) 150px, 250px" />
            </div>
          </div>
          <div className="landing-trust"><span><Stethoscope size={15} /> 真实临床动线</span><span><MessageCircleHeart size={15} /> 患儿与家长双角色</span><span><Sparkles size={15} /> 每一步都有证据</span></div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <span className="login-panel-icon"><Stethoscope size={21} /></span>
          <h2 className="section-title" id="login-title">进入儿科临床学习空间</h2>
          <div className="login-actions">
            <ChaoxingLoginEntry {...loginOptions} />
            {preview && (
              <>
                <a className="btn btn-secondary btn-block" href="/api/preview/login?role=student">评委预览 · 学生端</a>
                <a className="btn btn-quiet btn-block" href="/api/preview/login?role=teacher">评委预览 · 教师只读端</a>
              </>
            )}
          </div>
          <p className="login-footnote">教学模拟 · 非真实医疗建议 <ArrowRight size={12} /></p>
        </section>
      </div>
    </main>
  );
}
