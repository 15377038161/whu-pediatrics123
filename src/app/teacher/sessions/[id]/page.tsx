'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Clock3, MessageSquareText, Stethoscope } from 'lucide-react';
import { notFound } from 'next/navigation';
import { ReportView } from '@/components/report-view';
import type { SessionState, TrainingReport } from '@/domain/agent';
import type { TeacherReviewResult, TeacherStudentSummary } from '@/lib/repository';
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

  const [review, setReview] = useState<{ submitting: boolean; error: string | null; done: string | null }>({ submitting: false, error: null, done: null });
  const [reviewForm, setReviewForm] = useState<{ action: 'confirm' | 'adjust'; adjustedTotalScore: string; comment: string }>({ action: 'confirm', adjustedTotalScore: '', comment: '' });

  if (state.error) {
    return <div className="empty-state" role="alert"><p>{state.error}</p></div>;
  }
  if (!state.detail) {
    return <div className="empty-state" role="status"><p>正在读取训练记录…</p></div>;
  }

  const detail = state.detail;
  const questions = detail.session.messages.filter((message) => message.actor === 'student' || message.actor === 'child' || message.actor === 'parent');
  const notAssessable = detail.report ? detail.report.evidence.filter((item) => item.status === 'not_assessable') : [];

  /** 批次4：提交教师复核（append-only 留痕）；成功后用返回的报告刷新页面状态。 */
  async function submitReview() {
    if (!detail.report) return;
    const comment = reviewForm.comment.trim();
    if (comment === '') {
      setReview({ submitting: false, error: '复核理由必填，请填写复核依据。', done: null });
      return;
    }
    const adjusted = reviewForm.action === 'adjust' ? Number(reviewForm.adjustedTotalScore) : 0;
    if (reviewForm.action === 'adjust' && !Number.isFinite(adjusted)) {
      setReview({ submitting: false, error: '调整总分需填写有效数字。', done: null });
      return;
    }
    setReview({ submitting: true, error: null, done: null });
    try {
      const result = await authedFetch<TeacherReviewResult>(`/api/teacher/sessions/${encodeURIComponent(detail.report.sessionId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: reviewForm.action, adjustedTotalScore: adjusted, comment }),
      });
      const updated = result.report;
      setState((prev) => (prev.detail ? { detail: { ...prev.detail, report: updated } } : prev));
      setReview({ submitting: false, error: null, done: '复核留痕已保存。' });
      setReviewForm({ action: 'confirm', adjustedTotalScore: '', comment: '' });
    } catch (reason: unknown) {
      setReview({ submitting: false, error: reason instanceof Error ? reason.message : '复核提交失败，请稍后重试。', done: null });
    }
  }
  return <>
      <a className="text-link" href="/teacher"><ArrowLeft size={14} /> 返回学生列表</a>
      <div className="section-head"><div>{detail.student.avatarUrl ? <img className="student-avatar" src={detail.student.avatarUrl} alt="" width={44} height={44} loading="lazy" title="头像：按登录同步的超星号构造（用户可改资料，仅展示参考）" /> : null}<p className="eyebrow">{detail.student.studentNo ? `学号 ${detail.student.studentNo}` : '学号未提供'}{detail.student.chaoxingUid ? ` · 超星号 ${detail.student.chaoxingUid}（用户提供）` : ''}</p><h1 className="page-title">{detail.student.displayName} · 训练全过程</h1></div><span className="readonly-badge" style={{ background: '#e9efeb' }}>只读证据</span></div>
      {detail.report && <ReportView report={detail.report} readonly />}
      {detail.report && (
        <section className="report-section" style={{ marginTop: 14 }}>
          <h2>成绩复核（人工留痕）</h2>
          <p style={{ fontSize: 13, opacity: 0.75 }}>系统评分仅供参考：沟通等无法自动评分项需教师人工复核。复核记录按提交顺序追加、只增不改，理由必填；选择调整总分时由服务端按可评价满分约束。留痕对学生可见。</p>
          {detail.report.status === 'pending_review' && !(detail.report.teacherReviews?.length) && <span className="review-badge" data-level="pending">待复核</span>}
          {notAssessable.length > 0 && <p className="review-not-assessable"><strong>无法自动评分项：</strong>{notAssessable.map((item) => item.label).join('、')}——请结合问答与沟通原文复核后在下方留痕。</p>}
          <div className="review-form">
            <div className="review-form-row" role="radiogroup" aria-label="复核类型">
              <label><input type="radio" name="review-action" checked={reviewForm.action === 'confirm'} onChange={() => setReviewForm((prev) => ({ ...prev, action: 'confirm' }))} /> 确认系统评分</label>
              <label><input type="radio" name="review-action" checked={reviewForm.action === 'adjust'} onChange={() => setReviewForm((prev) => ({ ...prev, action: 'adjust' }))} /> 调整总分</label>
              {reviewForm.action === 'adjust' && <input type="number" min={0} step={1} value={reviewForm.adjustedTotalScore} onChange={(event) => setReviewForm((prev) => ({ ...prev, adjustedTotalScore: event.target.value }))} placeholder="调整后总分" aria-label="调整后总分" />}
            </div>
            <textarea rows={3} value={reviewForm.comment} onChange={(event) => setReviewForm((prev) => ({ ...prev, comment: event.target.value }))} placeholder="复核理由（必填，将留痕展示给学生）" aria-label="复核理由" />
            <div className="review-form-row">
              <button type="button" className="btn btn-primary" disabled={review.submitting} onClick={submitReview}>{review.submitting ? '提交中…' : '提交复核'}</button>
              {review.done && <span style={{ color: '#166534', fontSize: 13 }}>{review.done}</span>}
              {review.error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{review.error}</span>}
            </div>
          </div>
          {detail.report.teacherReviews && detail.report.teacherReviews.length > 0 && (
            <ul className="review-list" style={{ marginTop: 12 }}>
              {detail.report.teacherReviews.map((entry, index) => (
                <li className="review-entry" key={`${entry.reviewedAt}:${index}`}>
                  <p><strong>{entry.action === 'confirm' ? '确认系统评分' : entry.action === 'adjust' ? `调整总分 → ${entry.adjustedTotalScore ?? '—'} 分` : entry.action}</strong><span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{entry.reviewedAt.slice(0, 19).replace('T', ' ')}{entry.reviewerName ? ` · 复核人 ${entry.reviewerName}` : ''}</span></p>
                  <p className="preserve-lines">{entry.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
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
