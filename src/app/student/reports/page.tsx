'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, Sparkles, TrendingUp } from 'lucide-react';
import { findPublicCase } from '@/domain/case-catalog';
import { formatDateTime } from '@/lib/format-date';
import type { TrainingReport } from '@/domain/agent';
import { authedFetch } from '@/lib/authed-api';

/**
 * 学情报告列表（客户端化）：数据经 authedFetch，页面 HTML 不含用户数据。
 */
export default function ReportsPage() {
  const [reports, setReports] = useState<TrainingReport[] | null>(null);
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

  const average = reports.length ? Math.round(reports.reduce((sum, report) => sum + report.totalScore, 0) / reports.length) : null;
  const best = reports.length ? Math.max(...reports.map((report) => report.totalScore)) : null;
  const change = reports.length > 1 ? reports[0].totalScore - reports[1].totalScore : null;
  return (
    <>
      <p className="eyebrow">个人学情档案</p><h1 className="page-title">看见每一次临床成长</h1><p className="page-lead">每个分数都能回到原始问答和操作证据；先看趋势，再选择最值得补练的一项。</p>
      {reports.length > 0 && <section className="report-summary"><div><span>训练次数</span><strong>{reports.length}</strong></div><div><span>平均分</span><strong>{average}</strong></div><div><span>最好成绩</span><strong>{best}</strong></div><div><span>最近变化</span><strong className={(change ?? 0) >= 0 ? 'positive' : ''}>{change === null ? '首轮' : `${change >= 0 ? '+' : ''}${change}`}</strong></div></section>}
      {reports.length === 0 ? <div className="empty-state"><FileText /><h2>还没有训练报告</h2><p>完成一轮模拟病例或 OSCE 后，报告会出现在这里。</p><a className="btn btn-primary" href="/student/training?mode=guided">开始首轮训练</a></div> : (
        <><div className="section-head"><h2 className="section-title"><TrendingUp size={18} /> 最近记录</h2><span className="eyebrow"><Sparkles size={13} /> 证据可回放</span></div><div className="report-card-list">{reports.map((report) => { const caseProfile = findPublicCase(report.caseId); const caseTitle = report.caseTitle ?? caseProfile?.title ?? `病例 ${report.caseId}`; return <a className="report-card-link" key={report.id} href={`/student/reports/${report.id}`}><span className="report-card-score">{report.totalScore}<small>分</small></span><div><span className="report-mode">{report.mode === 'osce' ? 'OSCE 模拟站' : report.mode === 'practice' ? '专项训练' : '引导训练'}</span><strong>{caseTitle}</strong><small>{formatDateTime(report.createdAt)} · 查看证据与补练建议</small></div><ArrowRight size={17} /></a> })}</div></>
      )}
    </>
  );
}
