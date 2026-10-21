'use client';

import { useEffect, useState } from 'react';
import { TeacherDashboard } from '@/components/teacher-dashboard';
import type { TeacherStudentsWorkspace } from '@/lib/repository';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { authedFetch } from '@/lib/authed-api';

/**
 * 教师首页（客户端化）：学生学情经 /api/teacher/students（教师鉴权），页面 HTML 不含学生数据。
 */
export default function TeacherPage() {
  const [workspace, setWorkspace] = useState<TeacherStudentsWorkspace | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    authedFetch<TeacherStudentsWorkspace>('/api/teacher/students')
      .then((next) => {
        if (!cancelled) setWorkspace(next);
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
  if (!workspace) {
    return <div className="empty-state" role="status"><p>正在读取学生学情…</p></div>;
  }
  return <TeacherDashboard workspace={workspace} referenceTime={new Date().toISOString()} caseCatalog={TEACHER_CASE_CATALOG} />;
}
