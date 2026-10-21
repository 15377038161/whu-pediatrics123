import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';

export const dynamic = 'force-dynamic';
function privateResult<T>(value: T) {
  const response = ok(value);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/** D08 收口：病例创建/导入已废弃，导入类 action 统一返回 410 废弃响应。 */
function caseImportDeprecated() {
  return fail(
    {
      code: 'CASE_IMPORT_DEPRECATED',
      message: '病例创建与导入入口已收口，现行病例目录由平台统一维护；历史草稿保留只读，资料问题请联系项目管理员登记处理。',
      retryable: false,
    },
    undefined,
    410,
  );
}

/**
 * 教师病例草稿 API（D08 收口后）：
 * - GET  /api/teacher/case-drafts            历史草稿列表（只读）/ 草稿详情（只读）
 * - POST /api/teacher/case-drafts            已废弃：任何导入类 action（precheck/save）返回 410
 * 草稿与运行中事实快照隔离：本路由只读 case_draft_imports，不触碰 case_snapshot_*。
 * 授权与数据库 RLS 使用同一谓词（app_is_teacher 白名单 RPC），应用层与数据层判定一致；
 * 数据库侧教师 RLS 兜底，匿名/学生直接 Data API 读写均被 RLS 拒绝。
 */
export async function GET(request: NextRequest) {
  try {
    // 严格交集：应用层教师角色（requireAuth 'teacher'）AND 数据库白名单（app_is_teacher），非 OR、非仅白名单。
    const user = await requireAuth(request, 'teacher');
    if (!user.accessToken) return fail({ code: 'AUTH_REQUIRED', message: '缺少访问令牌', retryable: false }, undefined, 401);
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
    if (!(await isTeacherByWhitelist(user.accessToken))) {
      return fail({ code: 'FORBIDDEN', message: '仅教师可访问病例草稿', retryable: false }, undefined, 403);
    }
    const draftId = request.nextUrl.searchParams.get('id');
    if (draftId) {
      if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(draftId)) return fail({ code: 'INVALID_DRAFT_ID', message: '病例记录编号无效。', retryable: false }, undefined, 400);
      const { getDraft } = await import('@/lib/case-draft-import');
      const draft = await getDraft(user.accessToken, draftId);
      if (!draft) return fail({ code: 'DRAFT_NOT_FOUND', message: '未找到此草稿，请刷新列表。', retryable: false }, undefined, 404);
      return privateResult(draft);
    }
    const { listDrafts } = await import('@/lib/case-draft-import');
    return privateResult(await listDrafts(user.accessToken));
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    // 门控与 GET 同一谓词：匿名/学生/非白名单教师先按 401/403 拒绝，白名单教师得到明确废弃响应。
    const user = await requireAuth(request, 'teacher');
    if (!user.accessToken) return fail({ code: 'AUTH_REQUIRED', message: '缺少访问令牌', retryable: false }, undefined, 401);
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
    if (!(await isTeacherByWhitelist(user.accessToken))) {
      return fail({ code: 'FORBIDDEN', message: '仅教师可访问病例草稿', retryable: false }, undefined, 403);
    }
    return caseImportDeprecated();
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}
