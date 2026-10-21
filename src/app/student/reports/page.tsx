'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, Sparkles, TrendingUp } from 'lucide-react';
import { findPublicCase } from '@/domain/case-catalog';
import { formatDateTime } from '@/lib/format-date';
import { isUnscoredReport, unscoredReasonForDisplay } from '@/domain/training-rubric';
import type { TrainingReport } from '@/domain/agent';
import type { QuizAttemptSummary } from '@/lib/quiz-attempt';
import { authedFetch } from '@/lib/authed-api';

/**
 * 学情报告列表（客户端化）：数据经 authedFetch，页面 HTML 不含用户数据。
 * 阶段 F：题库练习批次（quiz_attempt_list_mine）并入本页统一展示——
 * 独立分区、独立正确率口径，不与临床训练分混算；点击回到题库页续答/复盘。
 */
export default function ReportsPage() {
  const [reports, setReports] = useState<TrainingReport[] | null>(null);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttemptSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    authedFetch<TrainingReport[]>('/api/reports')
      .then((list) => {
        if (!cancelled) setReports(list);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '报告读取失败');
      });
    // 题库批次列表：失败不阻断报告展示（分区独立容错）
    authedFetch<{ attempts: QuizAttemptSummary[] }>('/api/quiz/attempts')
      .then((data) => {
        if (!cancelled) setQuizAttempts(data.attempts ?? []);
      })
      .catch(() => {
        if (!cancelled) setQuizAttempts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="empty-state" role="alert"><p>{error}</p><Link className="btn btn-primary" href="/student/reports">重试</Link></div>;
  }
  if (!reports) {
    return <div className="empty-state" role="status"><p>正在读取学情档案…</p></div>;
  }

  // C-观察与报告-04：全部计分项均不可评价的报告记「未评分」——总分 0 不代表能力 0 分，
  // 不进入平均分/最好成绩/最近变化等趋势统计；训练次数仍计入全部报告。
  const scoredReports = reports.filter((report) => !isUnscoredReport(report));
  const unscoredCount = reports.length - scoredReports.length;
  const average = scoredReports.length ? Math.round(scoredReports.reduce((sum, report) => sum + report.totalScore, 0) / scoredReports.length) : null;
  const best = scoredReports.length ? Math.max(...scoredReports.map((report) => report.totalScore)) : null;
  const change = scoredReports.length > 1 ? scoredReports[0].totalScore - scoredReports[1].totalScore : null;
  return (
    <>
      <p className="eyebrow">个人学情档案</p><h1 className="page-title">看见每一次临床成长</h1><p className="page-lead">每个分数都能回到原始问答和操作证据；先看趋势，再选择最值得补练的一项。</p>
      {reports.length > 0 && <section className="report-summary"><div><span>训练次数</span><strong>{reports.length}</strong></div><div><span>平均分{unscoredCount > 0 ? `（已排除 ${unscoredCount} 次未评分）` : ''}</span><strong>{average === null ? '待评分' : average}</strong></div><div><span>最好成绩{unscoredCount > 0 ? `（已排除 ${unscoredCount} 次未评分）` : ''}</span><strong>{best === null ? '待评分' : best}</strong></div><div><span>最近变化</span><strong className={(change ?? 0) >= 0 ? 'positive' : ''}>{change === null ? (scoredReports.length === 1 ? '首轮' : '待评分') : `${change >= 0 ? '+' : ''}${change}`}</strong></div></section>}
      {reports.length === 0 ? <div className="empty-state"><FileText /><h2>还没有训练报告</h2><p>完成一轮模拟病例或 OSCE 后，报告会出现在这里。</p><a className="btn btn-primary" href="/student/training?mode=guided">开始首轮训练</a></div> : (
        <><div className="section-head"><h2 className="section-title"><TrendingUp size={18} /> 最近记录</h2><span className="eyebrow"><Sparkles size={13} /> 证据可回放</span></div><div className="report-card-list">{reports.map((report) => { const caseProfile = findPublicCase(report.caseId); const caseTitle = report.caseTitle ?? caseProfile?.title ?? `病例 ${report.caseId}`; const unscored = isUnscoredReport(report); return <a className="report-card-link" key={report.id} href={`/student/reports/${report.id}`}><span className="report-card-score" title={unscored ? unscoredReasonForDisplay(report) : undefined}>{unscored ? <small>未评分</small> : <>{report.totalScore}<small>分</small></>}</span><div><span className="report-mode">{report.mode === 'osce' ? 'OSCE 模拟站' : report.mode === 'practice' ? '专项训练' : '引导训练'}</span><strong>{caseTitle}</strong><small>{formatDateTime(report.createdAt)} · {unscored ? '未评分：缺少可评价判据，待教师复核' : '查看证据与补练建议'}</small></div><ArrowRight size={17} /></a> })}</div></>
      )}

      {/* 阶段 F：题库练习批次并入统一报告页——独立分区与正确率口径，不计入上方临床训练统计 */}
      {quizAttempts !== null && (
        <>
          <div className="section-head"><h2 className="section-title"><TrendingUp size={18} /> 题库练习记录</h2><span className="eyebrow">不计入临床评分统计</span></div>
          {quizAttempts.length === 0 ? (
            <div className="empty-state"><p>还没有题库练习记录。到「题库练习」开始一轮老师发布的题集吧。</p><a className="btn btn-primary" href="/student/quiz">去题库练习</a></div>
          ) : (
            <div className="report-card-list">
              {quizAttempts.map((attempt) => {
                const answered = attempt.answeredCount;
                const rate = answered > 0 ? Math.round((attempt.correctCount / answered) * 100) : null;
                const statusText = attempt.status === 'in_progress' ? '进行中' : attempt.status === 'abandoned' ? '已中断' : '已完成';
                return (
                  <a className="report-card-link" key={attempt.attemptId} href={`/student/quiz?attempt=${attempt.attemptId}`}>
                    <span className="report-card-score" title={attempt.status === 'in_progress' ? '继续练习' : attempt.status === 'abandoned' ? '已中断批次' : '查看错题复盘'}>
                      {attempt.status === 'completed' && rate !== null ? <>{rate}<small>%</small></> : <small>{statusText}</small>}
                    </span>
                    <div>
                      <span className="report-mode">题库练习 · {attempt.topic || '综合'} · v{attempt.version}</span>
                      <strong>{attempt.bankTitle}</strong>
                      <small>
                        {formatDateTime(attempt.startedAt)} · 已答 {answered}/{attempt.itemCount} 题
                        {attempt.status === 'completed' ? ` · 答对 ${attempt.correctCount} 题` : ''}
                        {' · '}{attempt.status === 'in_progress' ? '继续作答' : attempt.status === 'abandoned' ? '查看已答记录' : '错题复盘'}
                      </small>
                    </div>
                    <ArrowRight size={17} />
                  </a>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
