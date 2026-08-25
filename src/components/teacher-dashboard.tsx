'use client';

import { ArrowRight, Eye, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TeacherStudentSummary } from '@/lib/repository';

export function TeacherDashboard({ students }: { students: TeacherStudentSummary[] }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => students.filter((student) => `${student.displayName}${student.studentNo ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [query, students]);
  return (
    <>
      <section className="teacher-banner">
        <span className="readonly-badge"><Eye size={14} /> 教师只读视图</span>
        <h1>学生学情工作台</h1>
        <p>查看个人能力画像、问答原文、查体操作、诊疗决策与扣分证据。系统未提供任何发布任务、编辑病例或修改分数入口。</p>
      </section>
      <div className="student-filter">
        <label className="sr-only" htmlFor="student-search">按姓名或学号搜索</label>
        <div style={{ position: 'relative' }}><Search size={17} style={{ position: 'absolute', left: 13, top: 14, color: '#697b78' }} /><input id="student-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按姓名或学号搜索" style={{ paddingLeft: 40 }} /></div>
        <span className="readonly-badge" style={{ background: '#e9efeb', color: '#315755', width: 'fit-content' }}><ShieldCheck size={14} /> 仅限授权课程群组</span>
      </div>
      <div className="student-table-wrap">
        <table className="student-table">
          <thead><tr><th>学生</th><th>最近训练</th><th>最近得分</th><th>报告数</th><th>最近活跃</th><th>操作</th></tr></thead>
          <tbody>{filtered.map((student) => <tr key={student.id}>
            <td data-label="学生"><strong>{student.displayName}</strong><br/><small>{student.studentNo ?? '未绑定学号'}</small></td>
            <td data-label="最近训练">{student.latestMode === 'osce' ? 'OSCE 考核' : student.latestMode === 'practice' ? '专项训练' : '模拟病例'}</td>
            <td data-label="最近得分"><span className="score-tag">{student.latestScore ?? '—'}</span></td>
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
