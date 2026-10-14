'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Bone, ClipboardCheck, Clock3, HeartPulse, MessagesSquare, Sparkles, Stethoscope } from 'lucide-react';
import Image from 'next/image';
import { RandomAdmission } from '@/components/random-admission';
import Link from 'next/link';
import { CASE_CATALOG, getPublicCase, isTrainableCase } from '@/domain/case-catalog';
import type { SessionState, TrainingReport } from '@/domain/agent';
import { authedFetch } from '@/lib/authed-api';
import { useGateUser } from '@/components/auth-gate';
import { CaseLibrary } from '@/components/case-library';

/**
 * 学生首页（客户端化）：
 * 会话经 localStorage SDK → 数据必须经 authedFetch（Authorization → 网关 x-sandbox-authorization），
 * 页面 HTML 不含任何用户数据（客户端门控下防未鉴权抓取）。
 */
export default function StudentHome() {
  const user = useGateUser();
  const [reports, setReports] = useState<TrainingReport[] | null>(null);
  const [sessions, setSessions] = useState<SessionState[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      authedFetch<TrainingReport[]>('/api/reports'),
      authedFetch<SessionState[]>('/api/sessions'),
    ])
      .then(([reportList, sessionList]) => {
        if (cancelled) return;
        setReports(reportList);
        setSessions(sessionList);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '数据加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const latestReport = reports?.[0];
  const active = sessions?.find((session) => session.status === 'active' && isTrainableCase(session.caseId));
  const activeProfile = active ? getPublicCase(active.caseId) : CASE_CATALOG[0];
  const activeCase = active?.caseOptions ? { ...activeProfile, title: active.caseOptions.complaint ?? active.caseOptions.sourceName, age: active.caseOptions.age } : activeProfile;
  const abilities = latestReport?.abilities;

  if (error) {
    return (
      <div className="empty-state" role="alert">
        <p>{error}</p>
        <a className="btn btn-primary" href="/student">重试</a>
      </div>
    );
  }

  return (
    <>
      <p className="eyebrow">珞珈儿科 · 今日训练</p>
      <h1 className="page-title">你好，{user.displayName}</h1>
      <p className="page-lead">今天也从一个真实临床任务开始。放心提问、判断和操作，智能体只给方向，不会替你完成训练。</p>

      <section className="hero-desk student-hero">
        <Image className="student-hero-photo" src="/home-bg.webp" alt="" fill priority sizes="100vw" />
        <span className="student-hero-veil" aria-hidden="true" />
        <div className="student-hero-copy">
          <p className="eyebrow">{active ? '欢迎回来 · 进度已保存' : '本周旗舰病例'}</p>
          <h1>{active ? '接着上次的临床思路继续' : `今天接诊一位${activeCase.age}患儿`}</h1>
          <p>{activeCase.presentingSymptoms.length ? `就诊线索：${activeCase.presentingSymptoms.join('、')}。` : `本次学习：${activeCase.title}。`}病史和检查结果需要由你亲自问出来、查出来。</p>
          <div className="hero-actions">
            <a className="btn btn-primary" href={active ? `/student/training?session=${active.id}` : `/student/training?mode=guided&case=${activeCase.id}`}>
              {active ? '继续训练' : '开始接诊'} <ArrowRight size={17} />
            </a>
            <RandomAdmission excludeCaseId={active?.caseId} /><a className="btn btn-secondary" href="/student/practice"><Sparkles size={16} /> 先做专项热身</a>
          </div>
          <div className="case-note">{activeCase.expectedMinutes > 0 && <span><Clock3 size={14} /> 建议 {activeCase.expectedMinutes} 分钟</span>}<span><HeartPulse size={14} /> 自主问诊与检查</span><span>过程自动保存</span></div>
        </div>
      </section>

      <section className="journey-strip" aria-label="训练闭环">
        {['先观察', '再问诊', '做检查', '下判断', '会沟通', '看证据'].map((label, index) => <div key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}
      </section>

      <div className="section-head" id="case-library"><h2 className="section-title">模拟病例库</h2><span className="eyebrow">仅展示就诊线索</span></div>
      <CaseLibrary />

      <div className="section-head"><h2 className="section-title">选择你的训练方式</h2><span className="eyebrow">从完整病例到单项补练</span></div>
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
        <a className="entry" href="/student/anatomy">
          <span className="entry-mark"><Bone /></span><h3>儿童骨骼探索</h3><p>旋转观察6岁儿童研究模型，点选骨骼、分离结构，认识空间位置。</p><span className="entry-meta">进入儿童骨骼 <ArrowRight size={14} /></span>
        </a>
      </div>

      <div className="section-head"><h2 className="section-title">{latestReport?.scoreBasis === 'process' ? '最近训练过程完成度' : '最近能力画像'}</h2><Link className="text-link" href="/student/reports">查看报告</Link></div>
      <section className="ability-strip">
        {[
          ['问诊', abilities?.history, 25], ['查体', abilities?.examination, 25], ['推理', abilities?.reasoning, 20],
          ['安全', abilities?.safety, 15], ['沟通', abilities?.communication, 10], ['素养', abilities?.professionalism, 5],
        ].map(([label, score, max]) => <div className="ability-item" key={String(label)}><span className="ability-value">{score ?? '—'}</span><span className="ability-label">{label} / {max}</span></div>)}
      </section>
    </>
  );
}
