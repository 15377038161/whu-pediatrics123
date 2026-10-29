'use client';


import { useEffect, useState } from 'react';
import { TeacherDashboard } from '@/components/teacher-dashboard';
import type { TeacherStudentsWorkspace } from '@/lib/repository';
import type { TeacherCaseIndexEntry } from '@/lib/teacher-case-index';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { authedFetch } from '@/lib/authed-api';

/**
 * 教师首页（客户端化）：学生学情经 /api/teacher/students、病例索引三要素
 * （编号+诊断+完整主诉）经 /api/teacher/case-index（均教师鉴权），页面 HTML
 * 不含学生数据。索引视图读取失败时降级沿用客户端目录（编号+病名），不阻塞工作台。
 * TeacherCaseIndexEntry 为 type-only 导入（编译后擦除）：严禁改为值导入，
 * 否则会把服务端主诉映射（CASE_PUBLIC_IDS）带进客户端 bundle。
 */
export default function TeacherPage() {
  const [workspace, setWorkspace] = useState<TeacherStudentsWorkspace | null>(null);
  const [caseIndex, setCaseIndex] = useState<TeacherCaseIndexEntry[] | null>(null);
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
    authedFetch<TeacherCaseIndexEntry[]>('/api/teacher/case-index')
      .then((next) => {
        if (!cancelled) setCaseIndex(next);
      })
      .catch(() => {
        if (!cancelled) setCaseIndex(null);
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
  return <TeacherDashboard workspace={workspace} referenceTime={new Date().toISOString()} caseCatalog={TEACHER_CASE_CATALOG} caseIndex={caseIndex} />;
}
