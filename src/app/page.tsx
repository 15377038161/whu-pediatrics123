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
      </div>
      <div className="landing-content">
        <section className="landing-intro">
          <div className="brand-lockup">
            <div className="brand-seal" aria-hidden="true">珞珈</div>
            <div>
              <h1 className="brand-name">珞珈儿科智训</h1>
              <p className="brand-kicker">Wuhan University Pediatrics</p>
            </div>
          </div>
          <div className="landing-hero-row">
            <div className="landing-copy">
              <span className="welcome-chip"><HeartPulse size={15} /> 嗨，未来的小医生</span>
              <h2>把每一次练习，变成真正会接诊</h2>
              <p>和虚拟患儿、家长自然对话，在同一个病例中完成问诊、查体、临床决策、沟通与 OSCE 复盘。</p>
              <div className="learning-beads" aria-label="完整训练路径"><span>会问</span><i /><span>会查</span><i /><span>会判断</span></div>
            </div>
            <div className="landing-doctor" aria-hidden="true">
              <span className="doctor-speech">准备好接诊了吗？</span>
              <Image src="/media/brand/little-doctor-companion.webp" alt="" width={720} height={1080} priority sizes="(max-width: 699px) 150px, 230px" />
            </div>
          </div>
          <div className="ecg-monitor" aria-hidden="true">
            <div className="ecg-monitor-head"><span><Activity size={16} /> 教学智能体在线</span><span className="ecg-rate"><strong>108</strong> bpm · 模拟心率</span></div>
            <svg viewBox="0 0 720 120" preserveAspectRatio="none">
              <path className="ecg-gridline" d="M0 60H720" />
              <path className="ecg-line ecg-line-ghost" d="M0 60H95l15-1 11-18 15 54 18-83 18 49h60l18-1 10-16 14 48 17-72 17 41h116l16-1 12-20 15 58 18-88 19 51h166" />
              <path className="ecg-line" d="M0 60H95l15-1 11-18 15 54 18-83 18 49h60l18-1 10-16 14 48 17-72 17 41h116l16-1 12-20 15 58 18-88 19 51h166" />
            </svg>
            <span className="ecg-glow" />
          </div>
          <div className="landing-trust"><span><Stethoscope size={15} /> 真实临床动线</span><span><MessageCircleHeart size={15} /> 患儿与家长双角色</span><span><Sparkles size={15} /> 每一步都有证据</span></div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <span className="login-panel-icon"><Stethoscope size={21} /></span>
          <h2 className="section-title" id="login-title">进入儿科临床学习空间</h2>
          <p className="login-panel-copy">使用学习通身份进入，自动匹配学生或教师角色。</p>
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
