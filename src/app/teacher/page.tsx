'use client';

import { useEffect, useState } from 'react';
import { TeacherDashboard } from '@/components/teacher-dashboard';
import type { TeacherStudentSummary } from '@/lib/repository';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { authedFetch } from '@/lib/authed-api';

/**
 * 教师首页（客户端化）：学生学情经 /api/teacher/students（教师鉴权），页面 HTML 不含学生数据。
 */
export default function TeacherPage() {
  const [students, setStudents] = useState<TeacherStudentSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    authedFetch<TeacherStudentSummary[]>('/api/teacher/students')
      .then((list) => {
        if (!cancelled) setStudents(list);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '学生学情读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="empty-state" role="alert"><p>{error}</p><a className="btn btn-primary" href="/teacher">重试</a></div>;
  }
  if (!students) {
    return <div className="empty-state" role="status"><p>正在读取学生学情…</p></div>;
  }
  return <TeacherDashboard students={students} referenceTime={new Date().toISOString()} caseCatalog={TEACHER_CASE_CATALOG} />;
}
