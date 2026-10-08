import { CaseDraftImporter } from '@/components/case-draft-importer';
import { requirePageUser } from '@/lib/page-auth';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { redirect } from 'next/navigation';

export default async function TeacherCaseDraftsPage() {
  const user = await requirePageUser('teacher');
  if (!user.accessToken || !(await isTeacherByWhitelist(user.accessToken))) redirect('/teacher');
  return <main className="teacher-case-drafts">
    <a className="text-link" href="/teacher">返回教师工作台</a>
    <p className="eyebrow">病例草稿导入 · 教师受限</p>
    <h1 className="page-title">结构化病例草稿导入</h1>
    <p className="page-lead">粘贴结构化病例资料（JSON），预校验必填字段、来源匹配、脱敏与媒体审核状态后保存为草稿。草稿与运行中病例事实完全隔离，不发布给学生；修订通过递增草稿版本实现，旧版本不会被覆盖。3 个无独立来源的病种（新生儿脑梗死、支气管肺炎、格林巴利综合征）保持待补，不自动补造患者事实。</p>
    <CaseDraftImporter />
  </main>;
}
