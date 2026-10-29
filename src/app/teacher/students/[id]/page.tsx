'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, GraduationCap } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { TeacherStudentProfile } from '@/lib/repository';
import { formatDate } from '@/lib/format-date';
import { authedFetch, AuthedApiError } from '@/lib/authed-api';

/**
 * 学生档案页（教师只读）：学生基本信息 + 当前班级归属 + 授权范围内的训练会话索引。
 * 数据经 /api/teacher/students/[id]（教师鉴权），行级可见性由 RLS 决定
 * （学生换班后，原班教师仍可见归属其班级期间产生的会话）；404 时 notFound()。
 */
export default function TeacherStudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const [state, setState] = useState<{ profile?: TeacherStudentProfile; error?: string }>({});

  useEffect(() => {
    let cancelled = false;
    params
      .then(({ id }) => authedFetch<TeacherStudentProfile>(`/api/teacher/students/${encodeURIComponent(id)}`))
      .then((profile) => {
        if (!cancelled) setState({ profile });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof AuthedApiError && reason.code === 'STUDENT_NOT_FOUND') notFound();
        setState({ error: reason instanceof Error ? reason.message : '学生档案读取失败' });
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  if (state.error) {
    return <div className="empty-state" role="alert"><p>{state.error}</p></div>;
  }
  if (!state.profile) {
    return <div className="empty-state" role="status"><p>正在读取学生档案…</p></div>;
  }

  const { student, sessions, caseProgress } = state.profile;
  const scored = sessions.filter((session) => session.totalScore !== null && session.scoreBasis !== 'process');
  const average = scored.length ? Math.round(scored.reduce((sum, session) => sum + (session.totalScore ?? 0), 0) / scored.length) : null;
  return <>
    <a className="text-link" href="/teacher"><ArrowLeft size={14} /> 返回学生列表</a>
    <div className="section-head">
      <div>
        {student.avatarUrl ? <img className="student-avatar" src={student.avatarUrl} alt="" width={44} height={44} loading="lazy" title="头像：按登录同步的超星号构造（用户可改资料，仅展示参考）" /> : null}
        <p className="eyebrow">{student.studentNo ? `学号 ${student.studentNo}` : '学号未提供'}{student.chaoxingUid ? ` · 超星号 ${student.chaoxingUid}（用户提供）` : ''}</p>
        <h1 className="page-title">{student.displayName} · 学生档案</h1>
        <p className="page-lead"><GraduationCap size={14} style={{ verticalAlign: -2 }} /> 当前班级：{student.cohortName ?? '未归属任何班级（游客或已换班离开）'}</p>
      </div>
      <span className="readonly-badge" style={{ background: '#e9efeb' }}>只读证据</span>
    </div>
    <section className="teacher-metrics" aria-label="学生概览">
      <div><strong>{sessions.length}</strong><span>可见训练会话</span></div>
      <div><strong>{average ?? '—'}</strong><span>已评分报告平均分（{scored.length} 份计入）</span></div>
      <div><strong>{sessions.filter((session) => session.reportId === null).length}</strong><span>未生成报告</span></div>
      <div><strong>{sessions.filter((session) => session.reportStatus === 'pending_review' && !session.reviewed).length}</strong><span>待教师复核</span></div>
      <div><strong>{caseProgress.length}</strong><span>覆盖病例（训练过）</span></div>
    </section>
    <div className="case-progress-groups">
      {caseProgress.map((progress) => {
        const groupSessions = sessions.filter((session) => (session.caseId ?? '') === progress.caseId);
        return (
          <details className="student-case-group" key={progress.caseId || 'uncased'} open>
            <summary>
              <span className="case-index-number">#{progress.indexNumber ?? '—'}</span>
              <strong>{progress.caseLabel}</strong>
              <span>{progress.trainCount} 次训练 · 完成 {progress.completedCount} · 报告 {progress.reportCount}{progress.officialScore !== null ? ` · 正式 ${progress.officialScore} 分` : ''}{progress.retakeCount > 0 ? ` · 重练 ${progress.retakeCount} 次` : ''} · 最近 {progress.latestAt ? formatDate(progress.latestAt) : '—'}</span>
              {progress.pendingReviewCount > 0 && <span className="review-badge" data-level="pending">待复核 {progress.pendingReviewCount}</span>}
              <span className="score-tag" data-level={progress.latestScore === null ? 'empty' : progress.latestScore >= 85 ? 'strong' : progress.latestScore >= 80 ? 'steady' : 'attention'}>{progress.latestScore ?? '未评分'}</span>
            </summary>
            <table className="student-table">
              <thead><tr><th>训练时间</th><th>类型</th><th>得分</th><th>证据</th></tr></thead>
              <tbody>{groupSessions.map((session) => <tr key={session.sessionId}>
                <td data-label="训练时间">{formatDate(session.startedAt)}</td>
                <td data-label="类型">{session.mode === 'osce' ? 'OSCE 模拟站' : session.mode === 'practice' ? '专项训练' : '模拟病例'}</td>
                <td data-label="得分"><span className="score-tag" data-level={session.totalScore === null ? 'empty' : session.totalScore >= 85 ? 'strong' : session.totalScore >= 80 ? 'steady' : 'attention'}>{session.scoreBasis === 'process' ? `过程 ${session.totalScore ?? '—'}` : session.totalScore ?? '未评分'}</span></td>
                <td data-label="证据">{session.reportId ? <a className="text-link" href={`/teacher/sessions/${session.sessionId}`}><ClipboardList size={13} style={{ verticalAlign: -3 }} /> 查看全过程</a> : <span style={{ color: '#7d8c89' }}>暂无报告</span>}{session.reportStatus === 'pending_review' && !session.reviewed && <span className="review-badge" data-level="pending">待复核</span>}{session.reviewed && <span className="review-badge" data-level="reviewed">已复核</span>}</td>
              </tr>)}</tbody>
            </table>
          </details>
        );
      })}
    </div>
    {sessions.length === 0 && <div className="empty-state">该学生在你的授权范围内暂无可见训练记录（学生可能尚未训练，或训练产生于归属你班级之外的期间）。</div>}
  </>;
}
