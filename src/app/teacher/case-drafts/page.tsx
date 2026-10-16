import { CaseDraftImporter } from '@/components/case-draft-importer';
import { TeacherCaseImportPanel } from '@/components/teacher-case-import-panel';
import { CasePublicationPanel } from '@/components/case-publication-panel';

/**
 * 教师病例草稿导入页：身份/角色由布局门控负责；
 * 白名单（app_is_teacher）校验在 API 层强制执行（requireAuth 'teacher' AND 数据库白名单），
 * 非白名单教师的任何读写都会被 /api/teacher/case-drafts 以 403 拒绝。
 */
export default function TeacherCaseDraftsPage() {
  return (
    <main className="teacher-case-drafts">
      <a className="text-link" href="/teacher">
        返回教师工作台
      </a>
      <p className="eyebrow">教学资料 · 病例工作室</p>
      <h1 className="page-title">让临床经验成为教学病例</h1>
      <p className="page-lead">
        上传已有资料，核对临床信息，逐步完善每一份教学病例。
      </p>
      <CaseDraftImporter />
      <details className="studio-maintenance">
        <summary>
          已发布病例管理<span>查看现有病例的上架状态</span>
        </summary>
        <CasePublicationPanel />
      </details>
      <details className="studio-maintenance">
        <summary>
          资料维护<span>技术协助：既有资料的检查与缓存维护</span>
        </summary>
        <TeacherCaseImportPanel />
      </details>
    </main>
  );
}
