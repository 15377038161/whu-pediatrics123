import { CaseDraftArchive } from '@/components/case-draft-archive';
import { CasePackageImportPanel } from '@/components/case-package-import-panel';
import { CasePublicationPanel } from '@/components/case-publication-panel';

/**
 * 教师病例资料页：固定包换版 + 历史只读档案。
 * - 不开放新建、自由上传或任意批量导入；仅允许服务器固定病例包经指纹校验后换版；
 * - 身份/角色由布局门控负责，白名单（app_is_teacher）在 API 层再次强制执行；
 * - 固定包导入与双表回读复用教师 JWT，数据库 RLS 保持不变；
 * - 历史草稿、上下架管理、历史会话和报告快照均保留。
 */
export default function TeacherCaseDraftsPage() {
  return (
    <main className="teacher-case-drafts">
      <a className="text-link" href="/teacher">
        返回教师工作台
      </a>
      <p className="eyebrow">教学资料 · 病例工作室</p>
      <h1 className="page-title">教学病例资料</h1>
      <p className="page-lead">
        不开放新建或自由上传。白名单教师可对服务器固定病例包执行受控换版，并逐例核对双表结果；历史草稿、发布状态、训练记录与报告快照继续保留。
      </p>
      <details className="studio-maintenance" open>
        <summary>
          固定病例包换版<span>53 份源病例 · 67 个入口 · 双表回读</span>
        </summary>
        <CasePackageImportPanel />
      </details>
      <details className="studio-maintenance">
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
