'use client';

import { Activity, ArrowRight, Award, Eye, Search, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TeacherStudentSummary } from '@/lib/repository';
import type { TeacherCaseCatalogItem } from '@/domain/teacher-case-catalog';

export function TeacherDashboard({ students, referenceTime, caseCatalog }: { students: TeacherStudentSummary[]; referenceTime: string; caseCatalog: TeacherCaseCatalogItem[] }) {
  const [query, setQuery] = useState('');
  const [riskOnly, setRiskOnly] = useState(false);
  const scored = students.filter((student) => student.latestScore !== null && student.latestScoreBasis !== 'process');
  const average = scored.length ? Math.round(scored.reduce((sum, student) => sum + (student.latestScore ?? 0), 0) / scored.length) : null;
  const needsAttention = students.filter((student) => student.latestScoreBasis !== 'process' && student.latestScore !== null && student.latestScore < 80).length;
  const activeThisWeek = students.filter((student) => student.lastActiveAt && Date.parse(referenceTime) - Date.parse(student.lastActiveAt) < 7 * 86_400_000).length;
  const filtered = useMemo(() => students.filter((student) => `${student.displayName}${student.studentNo ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()) && (!riskOnly || (student.latestScoreBasis !== 'process' && student.latestScore !== null && student.latestScore < 80))), [query, riskOnly, students]);
  return (
    <>
      <section className="teacher-banner">
        <span className="readonly-badge"><Eye size={14} /> 教师只读视图</span>
        <h1>学生学情工作台</h1>
        <p>查看个人能力画像、问答原文、查体操作、诊疗决策与扣分证据。系统未提供任何发布任务、编辑病例或修改分数入口。</p>
      </section>
      <section className="teacher-metrics" aria-label="班级概览">
        <div><span className="metric-icon"><Users /></span><p>授权学生</p><strong>{students.length}</strong><small>当前课程群组</small></div>
        <div><span className="metric-icon"><Award /></span><p>最近平均分</p><strong>{average ?? '—'}</strong><small>{scored.length} 人已有报告</small></div>
        <div><span className="metric-icon"><Activity /></span><p>近 7 日活跃</p><strong>{activeThisWeek}</strong><small>有训练记录</small></div>
        <div data-alert={needsAttention > 0}><span className="metric-icon"><TriangleAlert /></span><p>建议关注</p><strong>{needsAttention}</strong><small>最近得分低于 80</small></div>
      </section>
      <section className="teacher-case-library"><div><span className="eyebrow">教师病例资料</span><h2>病例资源盘点</h2><p>全部病例已向学生开放；异名及具体亚型保留对应来源。学生查看资料文本和媒体，教师可核对原始文档并复核诊疗思路。</p></div><div className="teacher-case-stats"><strong>{caseCatalog.filter((item) => item.source === 'list').length}</strong><span>清单病种</span><strong>{caseCatalog.filter((item) => item.status === 'materials-indexed').length}</strong><span>精确匹配</span><strong>{caseCatalog.filter((item) => item.status === 'catalog-only').length}</strong><span>清单待核对</span><strong>{caseCatalog.filter((item) => item.status === 'folder-only').length}</strong><span>目录待核对</span></div></section>
      <details className="teacher-case-index"><summary>查看全部 {caseCatalog.length} 条病例资料记录</summary><div>{caseCatalog.map((item) => <a key={item.id} href={`/teacher/cases/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong><span>{item.status === 'materials-indexed' ? '精确匹配' : item.status === 'catalog-only' ? '清单待核对' : '目录待核对'}</span></a>)}</div></details>
      <div className="student-filter">
        <label className="sr-only" htmlFor="student-search">按姓名或学号搜索</label>
        <div style={{ position: 'relative' }}><Search size={17} style={{ position: 'absolute', left: 13, top: 14, color: '#697b78' }} /><input id="student-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按姓名或学号搜索" style={{ paddingLeft: 40 }} /></div>
        <div className="teacher-filter-actions"><button type="button" className="filter-chip" data-active={!riskOnly} onClick={() => setRiskOnly(false)}>全部学生</button><button type="button" className="filter-chip" data-active={riskOnly} onClick={() => setRiskOnly(true)}>建议关注 {needsAttention}</button><span className="readonly-badge"><ShieldCheck size={14} /> 仅限授权课程群组</span></div>
      </div>
      <div className="student-table-wrap">
        <table className="student-table">
          <thead><tr><th>学生</th><th>最近训练</th><th>最近得分</th><th>报告数</th><th>最近活跃</th><th>操作</th></tr></thead>
          <tbody>{filtered.map((student) => <tr key={student.id}>
            <td data-label="学生"><strong>{student.displayName}</strong><br/><small>{student.studentNo ?? '未绑定学号'}</small></td>
            <td data-label="最近训练">{student.latestMode === 'osce' ? 'OSCE 考核' : student.latestMode === 'practice' ? '专项训练' : '模拟病例'}</td>
            <td data-label="最近得分"><span className="score-tag" data-level={student.latestScore === null ? 'empty' : student.latestScore >= 85 ? 'strong' : student.latestScore >= 80 ? 'steady' : 'attention'}>{student.latestScoreBasis === 'process' ? `过程 ${student.latestScore ?? '—'}` : student.latestScore ?? '—'}</span></td>
            <td data-label="报告数">{student.reportCount}</td>
            <td data-label="最近活跃">{student.lastActiveAt ? new Date(student.lastActiveAt).toLocaleDateString('zh-CN') : '—'}</td>
            <td data-label="过程记录">{student.latestSessionId ? <a className="text-link" href={`/teacher/sessions/${student.latestSessionId}`}>查看全过程 <ArrowRight size={13} /></a> : <span style={{ color: '#7d8c89' }}>暂无证据</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {filtered.length === 0 && <div className="empty-state">没有找到匹配的学生。</div>}
    </>
  );
}
