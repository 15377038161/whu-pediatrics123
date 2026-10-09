'use client';

/**
 * 教师使用统计页（客户端化，HTML 不含学生数据）：
 * - 明细：学生训练次数/完成/退出/轮次/有效活跃时长/平均练习分（非正式成绩标识）；
 * - 汇总：去重学生、训练数、完成数、总轮次、总有效时长 + 日活趋势 + 病例/模式分布；
 * - 筛选：日期（from/to）、学生、病例；
 * - 导出：脱敏汇总 CSV（姓名/学号脱敏，不含明文 user_id、患者数据、对话内容）；
 * - 空数据诚实展示"暂无数据"（预览身份不伪造演示统计）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, CalendarRange, Download, Filter, LoaderCircle, Timer, TrendingUp, Users } from 'lucide-react';
import type { UsageStatsResult } from '@/app/api/teacher/usage-stats/route';
import { formatDate } from '@/lib/format-date';
import { authedFetch } from '@/lib/authed-api';

const MODE_LABELS: Record<string, string> = {
  guided: '带教引导',
  practice: '专项练习',
  osce: 'OSCE 考核',
  immersive: '沉浸问诊',
};

type Filters = {
  from: string;
  to: string;
  userId: string;
  caseId: string;
};

const EMPTY_RESULT: UsageStatsResult = {
  perStudent: [],
  overall: { studentCount: 0, sessionCount: 0, completedCount: 0, totalTurnCount: 0, totalActiveHours: 0 },
  dailyTrend: [],
  caseDistribution: [],
  scoreBasis: 'practice-only',
};

function buildQuery(filters: Filters, format?: 'csv'): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.caseId) params.set('caseId', filters.caseId);
  if (format) params.set('format', format);
  const query = params.toString();
  return query ? `/api/teacher/usage-stats?${query}` : '/api/teacher/usage-stats';
}

export default function TeacherUsageStatsPage() {
  const [filters, setFilters] = useState<Filters>({ from: '', to: '', userId: '', caseId: '' });
  const [result, setResult] = useState<UsageStatsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (current: Filters) => {
    setLoading(true);
    setError('');
    try {
      const data = await authedFetch<UsageStatsResult>(buildQuery(current));
      setResult(data);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : '统计读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次加载：promise 链内更新状态（不在 effect 内同步 setState）
  useEffect(() => {
    let cancelled = false;
    authedFetch<UsageStatsResult>(buildQuery({ from: '', to: '', userId: '', caseId: '' }))
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '统计读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const maxTrend = useMemo(() => Math.max(1, ...(result?.dailyTrend ?? []).map((item) => item.sessions)), [result]);

  const exportCsv = useCallback(() => {
    // fetch + blob 模式下载（跨域资源直接 <a download> 会被浏览器忽略 Content-Disposition）
    const url = buildQuery(filters, 'csv');
    void (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('导出失败');
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `usage-stats-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      } catch {
        setError('导出失败，请稍后重试。');
      }
    })();
  }, [filters]);

  return (
    <div className="app-frame">
      <main className="main-content" id="main-content">
        <section className="teacher-banner">
          <span className="readonly-badge"><BarChart3 size={14} /> 使用统计（只读）</span>
          <h1>学生使用统计</h1>
          <p>
            有效时长口径：页面可见且活跃（隐藏页、多标签非当前页、挂机不计入）；练习成绩为训练过程参考，非正式成绩。
            统计范围仅授权学生，导出为脱敏汇总。
          </p>
        </section>

        <section className="teacher-metrics" aria-label="使用统计汇总">
          <div><span className="metric-icon"><Users /></span><p>去重学生</p><strong>{result?.overall.studentCount ?? '—'}</strong><small>筛选范围内有训练记录</small></div>
          <div><span className="metric-icon"><Activity /></span><p>训练总数</p><strong>{result?.overall.sessionCount ?? '—'}</strong><small>完成 {result?.overall.completedCount ?? '—'} 次</small></div>
          <div><span className="metric-icon"><TrendingUp /></span><p>总轮次</p><strong>{result?.overall.totalTurnCount ?? '—'}</strong><small>全部会话对话轮</small></div>
          <div><span className="metric-icon"><Timer /></span><p>有效活跃</p><strong>{result ? `${result.overall.totalActiveHours} h` : '—'}</strong><small>服务端口径累计</small></div>
        </section>

        <section className="student-filter" aria-label="统计筛选">
          <label>
            <CalendarRange size={14} aria-hidden="true" />
            <span className="sr-only">开始日期</span>
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => updateFilter('from', event.target.value)} />
          </label>
          <label>
            <CalendarRange size={14} aria-hidden="true" />
            <span className="sr-only">结束日期</span>
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => updateFilter('to', event.target.value)} />
          </label>
          <label>
            <span className="sr-only">学生 UUID</span>
            <input type="text" placeholder="学生 ID（UUID，可选）" value={filters.userId} onChange={(event) => updateFilter('userId', event.target.value.trim())} />
          </label>
          <label>
            <span className="sr-only">病例 ID</span>
            <input type="text" placeholder="病例 ID（可选）" value={filters.caseId} onChange={(event) => updateFilter('caseId', event.target.value.trim())} />
          </label>
          <div className="teacher-filter-actions">
            <button type="button" className="filter-chip" data-active onClick={() => void load(filters)}>
              {loading ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Filter size={14} aria-hidden="true" />} 应用筛选
            </button>
            <button type="button" className="filter-chip" onClick={exportCsv} disabled={!result || result.perStudent.length === 0 && result.overall.sessionCount === 0}>
              <Download size={14} aria-hidden="true" /> 导出脱敏 CSV
            </button>
          </div>
        </section>

        {error && <div className="empty-state" role="alert"><p>{error}</p><button className="btn btn-primary" type="button" onClick={() => void load(filters)}>重试</button></div>}
        {!error && loading && !result && <div className="empty-state" role="status"><p>正在读取使用统计…</p></div>}

        {result && (
          <>
            <div className="student-table-wrap">
              <table className="student-table">
                <caption className="sr-only">学生使用明细（练习成绩非正式成绩）</caption>
                <thead>
                  <tr><th scope="col">学生</th><th scope="col">训练</th><th scope="col">完成/退出</th><th scope="col">轮次</th><th scope="col">有效时长</th><th scope="col">平均练习分（非正式）</th></tr>
                </thead>
                <tbody>
                  {result.perStudent.map((row) => (
                    <tr key={row.userId}>
                      <th scope="row">{row.displayName}{row.studentNo ? <small> {row.studentNo}</small> : null}</th>
                      <td data-label="训练">{row.sessionCount} 次</td>
                      <td data-label="完成/退出">{row.completedCount} / {row.abandonedCount}</td>
                      <td data-label="轮次">{row.turnCount}</td>
                      <td data-label="有效时长">{row.activeHours} h</td>
                      <td data-label="平均练习分"><span className="score-tag" data-level={row.avgPracticeScore >= 80 ? 'steady' : row.avgPracticeScore > 0 ? 'attention' : 'empty'}>{row.avgPracticeScore > 0 ? row.avgPracticeScore : '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.perStudent.length === 0 && <div className="empty-state">暂无学生使用数据（当前筛选条件下没有训练记录）。</div>}

            {result.dailyTrend.length > 0 && (
              <section aria-label="活跃趋势" className="trend-section">
                <h2>活跃趋势（按日）</h2>
                <ul className="trend-list">
                  {result.dailyTrend.map((item) => (
                    <li key={item.date}>
                      <span className="trend-date">{formatDate(item.date)}</span>
                      <span className="trend-bar" style={{ width: `${Math.round((item.sessions / maxTrend) * 100)}%` }} aria-hidden="true" />
                      <span className="trend-value">{item.activeStudents} 人 · {item.sessions} 次</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.caseDistribution.length > 0 && (
              <section aria-label="病例与模式分布" className="trend-section">
                <h2>病例与模式分布</h2>
                <ul className="trend-list">
                  {result.caseDistribution.map((item) => (
                    <li key={`${item.caseId}-${item.mode}`}>
                      <span className="trend-date">{item.caseId}{item.mode ? ` · ${MODE_LABELS[item.mode] ?? item.mode}` : ''}</span>
                      <span className="trend-value">{item.sessionCount} 次 · 完成 {item.completedCount}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
