'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Clock3, MessageSquareText, Stethoscope } from 'lucide-react';
import { notFound } from 'next/navigation';
import { ReportView } from '@/components/report-view';
import type { SessionState, TrainingReport } from '@/domain/agent';
import type { TeacherStudentSummary } from '@/lib/repository';
import { formatTime } from '@/lib/format-date';
import { authedFetch, AuthedApiError } from '@/lib/authed-api';

interface TeacherSessionDetail {
  student: TeacherStudentSummary;
  session: SessionState;
  report: TrainingReport | null;
}

/**
 * 教师查看学生训练全过程（客户端化）：数据经 /api/teacher/sessions/[id]（教师鉴权），
 * 页面 HTML 不含学生数据；404 时 notFound()。
 */
export default function TeacherSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [state, setState] = useState<{ detail?: TeacherSessionDetail; error?: string }>({});

  useEffect(() => {
    let cancelled = false;
    params
      .then(({ id }) => authedFetch<TeacherSessionDetail>(`/api/teacher/sessions/${encodeURIComponent(id)}`))
      .then((detail) => {
        if (!cancelled) setState({ detail });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof AuthedApiError && reason.code === 'SESSION_NOT_FOUND') notFound();
        setState({ error: reason instanceof Error ? reason.message : '训练记录读取失败' });
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  if (state.error) {
    return <div className="empty-state" role="alert"><p>{state.error}</p></div>;
  }
  if (!state.detail) {
    return <div className="empty-state" role="status"><p>正在读取训练记录…</p></div>;
  }

  const detail = state.detail;
  const questions = detail.session.messages.filter((message) => message.actor === 'student' || message.actor === 'child' || message.actor === 'parent');
  return <>
      <a className="text-link" href="/teacher"><ArrowLeft size={14} /> 返回学生列表</a>
      <div className="section-head"><div>{detail.student.avatarUrl ? <img className="student-avatar" src={detail.student.avatarUrl} alt="" width={44} height={44} loading="lazy" /> : null}<p className="eyebrow">{detail.student.studentNo ?? '未绑定学号'}</p><h1 className="page-title">{detail.student.displayName} · 训练全过程</h1></div><span className="readonly-badge" style={{ background: '#e9efeb' }}>只读证据</span></div>
      {detail.report && <ReportView report={detail.report} readonly />}
      <section className="report-section" style={{ marginTop: 14 }}>
        <h2>学生临床提交原文</h2>
        <div className="clinical-submissions">
          <div><strong>病情摘要与诊断</strong><p>{detail.session.decision?.summary ?? '未提交'}</p><p>初步诊断：{detail.session.decision?.diagnosis ?? '未提交'}</p><p>诊断依据：{detail.session.decision?.diagnosisBasis || '未提交（历史会话）'}</p><p>鉴别诊断：{detail.session.decision?.differentials || '未提交'}</p></div>
          <div><strong>治疗及处置计划</strong><p>首要处置：{detail.session.plan?.priority ?? '未提交'}</p><p>{detail.session.plan?.detail ?? '未提交'}</p></div>
          <div><strong>患儿与家长沟通</strong><p>{detail.session.communication ?? '未提交'}</p></div>
        </div>
      </section>
      <div className="report-grid">
        <section className="report-section"><h2><MessageSquareText size={17} style={{ verticalAlign: -3 }} /> 问答与沟通原文</h2><div className="message-list">{questions.map((message) => <div className="message" data-actor={message.actor} key={message.id}><p className="message-label">{message.actor === 'student' ? '学生（医生）' : message.actor === 'child' ? '患儿' : '家长'} · {message.emotion}</p><div className="message-bubble">{message.content}</div></div>)}</div></section>
        <section className="report-section"><h2><Stethoscope size={17} style={{ verticalAlign: -3 }} /> 操作与决策时间线</h2><ol className="timeline">{detail.session.events.map((event) => <li key={event.id}><strong>{event.summary}</strong><span><Clock3 size={12} style={{ verticalAlign: -2 }} /> {formatTime(event.createdAt)} · {event.evidenceCodes.join('、') || '阶段操作'}</span></li>)}</ol></section>
      </div>
  </>;
}
