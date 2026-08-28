import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Activity, Sparkles, Stethoscope } from 'lucide-react';
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
          <div className="landing-copy">
            <h2>从真实问诊，到可解释的临床能力成长</h2>
            <p>在同一个病例记忆中完成自主问诊、可视化查体、临床决策、家长沟通与 OSCE 考核。</p>
          </div>
          <div className="ecg-monitor" aria-hidden="true">
            <div className="ecg-monitor-head"><span><Activity size={16} /> 教学智能体在线</span><span>儿科临床训练</span></div>
            <svg viewBox="0 0 720 120" preserveAspectRatio="none">
              <path className="ecg-gridline" d="M0 60H720" />
              <path className="ecg-line" d="M0 60H95l15-1 11-18 15 54 18-83 18 49h60l18-1 10-16 14 48 17-72 17 41h116l16-1 12-20 15 58 18-88 19 51h166" />
            </svg>
            <span className="ecg-glow" />
          </div>
          <div className="landing-trust"><span><Stethoscope size={15} /> 临床流程驱动</span><span><Sparkles size={15} /> 多角色动态应答</span></div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
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
        </section>
      </div>
    </main>
  );
}
