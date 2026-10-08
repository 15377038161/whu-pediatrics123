import { notFound } from 'next/navigation';
import { CaseResourcePanel } from '@/components/case-resource-panel';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { requirePageUser } from '@/lib/page-auth';
import { readTeacherCaseData } from '@/lib/teacher-case-data';
import { getTeacherCaseResourceRoot } from '@/lib/teacher-case-resources';

export default async function TeacherCasePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser('teacher');
  const { id } = await params;
  let caseId: string;
  try {
    caseId = decodeURIComponent(id);
  } catch {
    notFound();
  }
  const item = TEACHER_CASE_CATALOG.find((entry) => entry.id === caseId);
  if (!item) notFound();
  const source = readTeacherCaseData(caseId);
  return <main className="teacher-case-detail">
    <a className="text-link" href="/teacher">返回教师工作台</a>
    <p className="eyebrow">病例资料核对 · 教师只读</p>
    <h1 className="page-title">{item.name}</h1>
    <p className="page-lead">{item.category}。全部病种已向学生开放学习。{source ? `当前使用“${source.sourceName}”的病例正文与相关检查资料。` : '该病种尚无独立原始正文，可开展诊疗思路记录。'}学生报告记录过程完成度，临床判断仍可由教师复核。</p>
    <div className="case-note"><a className="text-link" href={`/student/training?mode=guided&case=${encodeURIComponent(item.id)}`}>以学生方式进入病例</a><span>{source ? '真实资料学习' : '自主研习入口'}</span></div>
    {getTeacherCaseResourceRoot(caseId) ? <CaseResourcePanel caseId={item.id} title="教师原始病例资料" /> : <div className="empty-state">此病种暂无独立资料目录。</div>}
  </main>;
}
