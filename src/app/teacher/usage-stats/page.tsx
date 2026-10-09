'use client';

/**
 * 教师使用统计页（客户端化，HTML 不含学生数据）：
 * - 明细：学生训练次数/完成/进行中/退出/轮次/有效活跃时长/平均练习分（非正式成绩标识）；
 * - 汇总：去重学生、训练数、完成数、进行中、总轮次、总有效时长 + 日/周活趋势 + 病例/模式分布 + 题库薄弱项；
 * - ⑥账号隔离：unknown 账号展示"未验证"徽标（历史无法判定，如实标记）；
 * - 筛选：日期（from/to，严格日历校验）、学生、病例、单学生逐次明细下钻；
 * - 导出：脱敏汇总 CSV（姓名/学号脱敏，公式注入防护，不含明文 user_id、患者数据、对话内容）；
 * - 空数据诚实展示"暂无数据"（预览身份不伪造演示统计）；
 * - ⑤口径声明：本统计基于学生端学习行为埋点，非防篡改学习证据，正式成绩以考核记录为准。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, CalendarRange, Download, Filter, LoaderCircle, Timer, TrendingUp, Users, AlertTriangle } from 'lucide-react';
import type { UsageStatsResult, StudentUsageRow } from '@/app/api/teacher/usage-stats/route';
import { formatDate } from '@/lib/format-date';
import { authedFetch } from '@/lib/authed-api';

const MODE_LABELS: Record<string, string> = {
  guided: '带教引导',
  practice: '专项练习',
  osce: 'OSCE 考核',
  immersive: '沉浸问诊',
};

const STATUS_KIND_LABELS: Record<string, string> = {
  completed: '已完成',
  in_progress: '进行中',
  abandoned: '中途退出',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '基础',
  medium: '进阶',
  hard: '挑战',
  unknown: '未分级',
};

type Filters = {
  from: string;
  to: string;
  userId: string;
  caseId: string;
};

const EMPTY_RESULT: UsageStatsResult = {
  perStudent: [],
  overall: { studentCount: 0, sessionCount: 0, completedCount: 0, inProgressCount: 0, totalTurnCount: 0, totalActiveHours: 0 },
  dailyTrend: [],
  weeklyTrend: [],
  caseDistribution: [],
  weakAreas: [],
  recentSessions: [],
  scoreBasis: 'practice-only',
};

function buildQuery(filters: Filters, detailUserId?: string, format?: 'csv'): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.caseId) params.set('caseId', filters.caseId);
  if (detailUserId) params.set('detailUserId', detailUserId);
  if (format) params.set('format', format);
  const query = params.toString();
  return query ? `/api/teacher/usage-stats?${query}` : '/api/teacher/usage-stats';
}

export default function TeacherUsageStatsPage() {
  const [filters, setFilters] = useState<Filters>({ from: '', to: '', userId: '', caseId: '' });
  const [result, setResult] = useState<UsageStatsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** ⑧单学生逐次明细下钻：选中后（独立于 userId 筛选）展示该学生最近训练 */
  const [detailUser, setDetailUser] = useState<StudentUsageRow | null>(null);

  const load = useCallback(async (current: Filters) => {
    setLoading(true);
    setError('');
    try {
      const data = await authedFetch<UsageStatsResult>(buildQuery(current));
      setResult(data);
      if (detailUser) {
        const row = data.perStudent.find((item) => item.userId === detailUser.userId) ?? null;
        setDetailUser(row);
      }
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : '统计读取失败');
    } finally {
      setLoading(false);
    }
  }, [detailUser]);

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

  /** 打开单学生下钻：带 detailUserId 重新拉取（受限明细，仅教师可见） */
  const openDetail = useCallback(async (row: StudentUsageRow) => {
    setDetailUser(row);
    setError('');
    try {
      const data = await authedFetch<UsageStatsResult>(buildQuery(filters, row.userId));
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '明细读取失败');
    }
  }, [filters]);

  const maxTrend = useMemo(() => Math.max(1, ...(result?.dailyTrend ?? []).map((item) => item.sessions)), [result]);

  const exportCsv = useCallback(() => {
    // fetch + blob 模式下载（跨域资源直接 <a download> 会被浏览器忽略 Content-Disposition）
    const url = buildQuery(filters, undefined, 'csv');
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
            有效时长口径：页面可见且活跃（隐藏页、多标签非当前页、挂机不计入）；进行中 = 2 小时内有更新，中途退出 = 停滞超 2 小时。
            统计按北京时间自然日。练习成绩为训练过程参考，非正式成绩。统计范围仅授权学生，导出为脱敏汇总。
          </p>
          <p className="stats-basis-note">
            <AlertTriangle size={14} aria-hidden="true" />
            本统计基于学生端学习行为埋点，非防篡改学习证据；正式成绩与学时认定以考核记录为准。
          </p>
        </section>

        <section className="teacher-metrics" aria-label="使用统计汇总">
          <div><span className="metric-icon"><Users /></span><p>去重学生</p><strong>{result?.overall.studentCount ?? '—'}</strong><small>筛选范围内有训练记录</small></div>
          <div><span className="metric-icon"><Activity /></span><p>训练总数</p><strong>{result?.overall.sessionCount ?? '—'}</strong><small>完成 {result?.overall.completedCount ?? '—'} · 进行中 {result?.overall.inProgressCount ?? '—'}</small></div>
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
                <caption className="sr-only">学生使用明细（练习成绩非正式成绩；&quot;未验证&quot;=历史账号无法判定真实性）</caption>
                <thead>
                  <tr><th scope="col">学生</th><th scope="col">训练</th><th scope="col">完成/进行中/退出</th><th scope="col">轮次</th><th scope="col">有效时长</th><th scope="col">平均练习分（非正式）</th><th scope="col">明细</th></tr>
                </thead>
                <tbody>
                  {result.perStudent.map((row) => (
                    <tr key={row.userId} data-selected={detailUser?.userId === row.userId || undefined}>
                      <th scope="row">
                        {row.displayName}
                        {row.accountKind === 'unknown' ? <small className="account-kind-badge" title="历史账号，无法判定是否为真实学生"> 未验证</small> : null}
                        {row.studentNo ? <small> {row.studentNo}</small> : null}
                      </th>
                      <td data-label="训练">{row.sessionCount} 次</td>
                      <td data-label="完成/进行中/退出">{row.completedCount} / {row.inProgressCount} / {row.abandonedCount}</td>
                      <td data-label="轮次">{row.turnCount}</td>
                      <td data-label="有效时长">{row.activeHours} h</td>
                      <td data-label="平均练习分"><span className="score-tag" data-level={row.avgPracticeScore >= 80 ? 'steady' : row.avgPracticeScore > 0 ? 'attention' : 'empty'}>{row.avgPracticeScore > 0 ? row.avgPracticeScore : '—'}</span></td>
                      <td data-label="明细">
                        <button type="button" className="filter-chip" onClick={() => void openDetail(row)} aria-expanded={detailUser?.userId === row.userId}>
                          {detailUser?.userId === row.userId ? '收起' : '查看'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.perStudent.length === 0 && <div className="empty-state">暂无学生使用数据（当前筛选条件下没有训练记录）。</div>}

            {detailUser && result.recentSessions.length > 0 && (
              <section aria-label={`${detailUser.displayName} 逐次训练明细`} className="trend-section">
                <h2>{detailUser.displayName} · 逐次训练明细（最近 {result.recentSessions.length} 次）</h2>
                <div className="student-table-wrap">
                  <table className="student-table">
                    <thead>
                      <tr><th scope="col">开始时间（北京时间）</th><th scope="col">病例</th><th scope="col">模式</th><th scope="col">状态</th><th scope="col">轮次</th><th scope="col">练习分（非正式）</th></tr>
                    </thead>
                    <tbody>
                      {result.recentSessions.map((item) => (
                        <tr key={item.sessionId}>
                          <th scope="row">{item.startedAt}</th>
                          <td data-label="病例">{item.caseId}</td>
                          <td data-label="模式">{MODE_LABELS[item.mode] ?? item.mode}</td>
                          <td data-label="状态">{STATUS_KIND_LABELS[item.statusKind] ?? item.statusKind}</td>
                          <td data-label="轮次">{item.turnCount}</td>
                          <td data-label="练习分">{item.practiceScore > 0 ? item.practiceScore : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {result.weakAreas.length > 0 && (
              <section aria-label="题库薄弱项" className="trend-section">
                <h2>题库薄弱项（正确率 &lt; 80%，样本 ≥ 3）</h2>
                <div className="student-table-wrap">
                  <table className="student-table">
                    <thead>
                      <tr><th scope="col">病例</th><th scope="col">难度</th><th scope="col">作答数</th><th scope="col">正确数</th><th scope="col">正确率</th></tr>
                    </thead>
                    <tbody>
                      {result.weakAreas.map((item) => (
                        <tr key={`${item.caseId}-${item.difficulty}`}>
                          <th scope="row">{item.caseId}</th>
                          <td data-label="难度">{DIFFICULTY_LABELS[item.difficulty] ?? item.difficulty}</td>
                          <td data-label="作答数">{item.assigned}</td>
                          <td data-label="正确数">{item.correct}</td>
                          <td data-label="正确率"><span className="score-tag" data-level="attention">{Math.round(item.correctRate * 100)}%</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {result.dailyTrend.length > 0 && (
              <section aria-label="活跃趋势（按日）" className="trend-section">
                <h2>活跃趋势（按日，北京时间）</h2>
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

            {result.weeklyTrend.length > 0 && (
              <section aria-label="活跃趋势（按周）" className="trend-section">
                <h2>活跃趋势（按周，周一起始）</h2>
                <ul className="trend-list">
                  {result.weeklyTrend.map((item) => (
                    <li key={item.week}>
                      <span className="trend-date">{formatDate(item.week)} 周</span>
                      <span className="trend-bar" style={{ width: `${Math.round((item.sessions / Math.max(1, ...result.weeklyTrend.map((w) => w.sessions))) * 100)}%` }} aria-hidden="true" />
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
