import { ArrowRight, ClipboardCheck, MessagesSquare, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { CASE_CATALOG, getPublicCase } from '@/domain/case-catalog';
import { AgentRepository } from '@/lib/repository';
import { requirePageUser } from '@/lib/page-auth';

export default async function StudentHome() {
  const user = await requirePageUser('student');
  const repository = new AgentRepository(user);
  const [reports, sessions] = await Promise.all([repository.listOwnReports(), repository.listOwnSessions()]);
  const latestReport = reports[0];
  const active = sessions.find((session) => session.status === 'active');
  const activeCase = active ? getPublicCase(active.caseId) : CASE_CATALOG[0];
  const abilities = latestReport?.abilities;
  return (
    <>
      <p className="eyebrow">珞珈儿科能力图谱</p>
      <h1 className="page-title">上午好，{user.displayName}</h1>
      <p className="page-lead">今天从一个真实临床任务开始。智能体会记住你在每个阶段获得的证据。</p>

      <section className="hero-desk">
        <p className="eyebrow" style={{ color: '#e3bd7b' }}>{active ? '继续上次训练' : '本周旗舰病例'}</p>
        <h1>{active ? '继续上次临床训练' : `${activeCase.category}模拟接诊`}</h1>
        <p>就诊线索：{activeCase.presentingSymptoms.join('、')}。患儿信息、病史和检查结果需由你在训练中逐步获取。</p>
        <div className="hero-actions">
          <a className="btn btn-primary" href={active ? `/student/training?session=${active.id}` : `/student/training?mode=guided&case=${activeCase.id}`}>
            {active ? '继续训练' : '开始病例'} <ArrowRight size={17} />
          </a>
          <a className="btn btn-secondary" href="/about/agent">智能体如何工作</a>
        </div>
        <div className="case-note"><span>建议 {activeCase.expectedMinutes} 分钟</span><span>自主问诊与检查</span><span>武汉大学校本框架</span></div>
      </section>

      <div className="section-head" id="case-library"><h2 className="section-title">模拟病例库</h2><span className="eyebrow">仅展示就诊线索</span></div>
      <div className="case-library">
        {CASE_CATALOG.map((caseItem, index) => (
          <article className="case-card" key={caseItem.id}>
            <div className="case-card-copy">
              <p className="case-number">病例 {String(index + 1).padStart(2, '0')}</p>
              <h3>{caseItem.category}</h3>
              <div className="symptom-list" aria-label="就诊症状">
                {caseItem.presentingSymptoms.map((symptom) => <span key={symptom}>{symptom}</span>)}
              </div>
              <a className="btn btn-secondary" href={`/student/training?mode=guided&case=${caseItem.id}`}>进入病例 <ArrowRight size={15} /></a>
            </div>
          </article>
        ))}
      </div>

      <div className="section-head"><h2 className="section-title">三个学习入口</h2><span className="eyebrow">玩起来 · 用起来 · 学起来</span></div>
      <div className="entry-list">
        <a className="entry" href="#case-library">
          <span className="entry-mark"><Stethoscope /></span><h3>模拟病例</h3><p>在完整病例中自主问诊、检查和决策，训练模式提供方向性反馈。</p><span className="entry-meta">进入临床工作台 <ArrowRight size={14} /></span>
        </a>
        <a className="entry" href="/student/practice">
          <span className="entry-mark"><MessagesSquare /></span><h3>专项训练</h3><p>将旗舰病例拆为病史采集、肺部查体、危重识别和家长沟通四个任务。</p><span className="entry-meta">选择专项 <ArrowRight size={14} /></span>
        </a>
        <a className="entry" href="/student/osce">
          <span className="entry-mark"><ClipboardCheck /></span><h3>OSCE 考站</h3><p>同一病例切换为限时、无提示、不可重试的证据化考核。</p><span className="entry-meta">查看考站说明 <ArrowRight size={14} /></span>
        </a>
      </div>

      <div className="section-head"><h2 className="section-title">最近能力画像</h2><Link className="text-link" href="/student/reports">查看报告</Link></div>
      <section className="ability-strip">
        {[
          ['问诊', abilities?.history, 25], ['查体', abilities?.examination, 25], ['推理', abilities?.reasoning, 20],
          ['安全', abilities?.safety, 15], ['沟通', abilities?.communication, 10], ['素养', abilities?.professionalism, 5],
        ].map(([label, score, max]) => <div className="ability-item" key={String(label)}><span className="ability-value">{score ?? '—'}</span><span className="ability-label">{label} / {max}</span></div>)}
      </section>
    </>
  );
}
