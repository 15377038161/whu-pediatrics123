import { CaseDraftArchive } from '@/components/case-draft-archive';
import { CasePublicationPanel } from '@/components/case-publication-panel';

/**
 * 教师病例草稿页（D08 收口后：只读 + 问题反馈）：
 * - 病例创建/导入入口已收口：本页不再提供新建、上传或批量导入操作；
 * - 身份/角色由布局门控负责；白名单（app_is_teacher）校验在 API 层强制执行，
 *   非白名单教师的任何读写都会被 /api/teacher/case-drafts 以 403 拒绝；
 * - 历史草稿保留只读（CaseDraftArchive）；病例上下架管理保留（CasePublicationPanel）；
 * - 资料问题反馈渠道见页面说明（病例资料问题经 readiness 登记表线下流转，不再经本页上传）。
 */
export default function TeacherCaseDraftsPage() {
  return (
    <main className="teacher-case-drafts">
      <a className="text-link" href="/teacher">
        返回教师工作台
      </a>
      <p className="eyebrow">教学资料 · 病例工作室</p>
      <h1 className="page-title">教学病例资料（只读）</h1>
      <p className="page-lead">
        病例创建与导入入口已收口：现行病例目录由平台统一维护，教师不再直接创建或导入病例。以下为收口前保存的历史草稿与目录发布状态，仅供核对；发现资料问题请联系项目管理员登记处理。
      </p>
      <details className="studio-maintenance" open>
        <summary>
          历史草稿档案<span>收口前保存的草稿，只读保留</span>
        </summary>
        <CaseDraftArchive />
      </details>
      <details className="studio-maintenance">
        <summary>
          已发布病例管理<span>查看现有病例的上架状态</span>
        </summary>
        <CasePublicationPanel />
      </details>
    </main>
  );
}
