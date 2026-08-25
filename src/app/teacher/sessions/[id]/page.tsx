import { ArrowLeft, Clock3, MessageSquareText, Stethoscope } from 'lucide-react';
import { notFound } from 'next/navigation';
import { ReportView } from '@/components/report-view';
import { AgentRepository } from '@/lib/repository';
import { requirePageUser } from '@/lib/page-auth';

export default async function TeacherSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser('teacher');
  let detail;
  try {
    detail = await new AgentRepository(user).getTeacherSession((await params).id);
  } catch { notFound(); }
  const questions = detail.session.messages.filter((message) => message.actor === 'student' || message.actor === 'child' || message.actor === 'parent');
  return <>
      <a className="text-link" href="/teacher"><ArrowLeft size={14} /> 返回学生列表</a>
      <div className="section-head"><div><p className="eyebrow">{detail.student.studentNo ?? '未绑定学号'}</p><h1 className="page-title">{detail.student.displayName} · 训练全过程</h1></div><span className="readonly-badge" style={{ background: '#e9efeb' }}>只读证据</span></div>
      {detail.report && <ReportView report={detail.report} readonly />}
      <section className="report-section" style={{ marginTop: 14 }}>
        <h2>学生临床提交原文</h2>
        <div className="clinical-submissions">
          <div><strong>病情摘要与诊断</strong><p>{detail.session.decision?.summary ?? '未提交'}</p><p>初步诊断：{detail.session.decision?.diagnosis ?? '未提交'}</p><p>鉴别诊断：{detail.session.decision?.differentials || '未提交'}</p></div>
          <div><strong>治疗及处置计划</strong><p>首要处置：{detail.session.plan?.priority ?? '未提交'}</p><p>{detail.session.plan?.detail ?? '未提交'}</p></div>
          <div><strong>患儿与家长沟通</strong><p>{detail.session.communication ?? '未提交'}</p></div>
        </div>
      </section>
      <div className="report-grid">
        <section className="report-section"><h2><MessageSquareText size={17} style={{ verticalAlign: -3 }} /> 问答与沟通原文</h2><div className="message-list">{questions.map((message) => <div className="message" data-actor={message.actor} key={message.id}><p className="message-label">{message.actor === 'student' ? '学生（医生）' : message.actor === 'child' ? '患儿' : '家长'} · {message.emotion}</p><div className="message-bubble">{message.content}</div></div>)}</div></section>
        <section className="report-section"><h2><Stethoscope size={17} style={{ verticalAlign: -3 }} /> 操作与决策时间线</h2><ol className="timeline">{detail.session.events.map((event) => <li key={event.id}><strong>{event.summary}</strong><span><Clock3 size={12} style={{ verticalAlign: -2 }} /> {new Date(event.createdAt).toLocaleTimeString('zh-CN')} · {event.evidenceCodes.join('、') || '阶段操作'}</span></li>)}</ol></section>
      </div>
  </>;
}
