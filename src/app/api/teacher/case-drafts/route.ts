import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist, normalizeDraftVersion, parseDraftPayload, precheckDraft, saveDraft } from '@/lib/case-draft-import';

export const dynamic = 'force-dynamic';
function privateResult<T>(value: T) {
  const response = ok(value);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/**
 * 教师病例草稿导入 API（仅教师）：
 * - GET  /api/teacher/case-drafts            草稿列表
 * - POST /api/teacher/case-drafts            预校验或保存
 *   body: { action: 'precheck' | 'save', draftVersion?: string,
 *           desensitized?: boolean, mediaReviewed?: boolean, payload: {...} }
 * 草稿与运行中事实快照隔离：本路由只读写 case_draft_imports，不触碰 case_snapshot_*。
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
    // 严格交集：应用层教师角色（requireAuth 'teacher'）AND 数据库白名单（app_is_teacher），非 OR、非仅白名单。
    const user = await requireAuth(request, 'teacher');
    if (!user.accessToken) return fail({ code: 'AUTH_REQUIRED', message: '缺少访问令牌', retryable: false }, undefined, 401);
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
    if (!(await isTeacherByWhitelist(user.accessToken))) {
      return fail({ code: 'FORBIDDEN', message: '仅教师可导入病例草稿', retryable: false }, undefined, 403);
    }
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action === 'save' ? 'save' : 'precheck';
    const payload = parseDraftPayload(body.payload);
    const draftVersion = normalizeDraftVersion(body.draftVersion);
    const options = {
      desensitized: body.desensitized === true,
      mediaReviewed: body.mediaReviewed === true,
      sourceName: typeof body.sourceName === 'string' && body.sourceName.trim() ? body.sourceName.trim() : undefined,
    };
    if (action === 'precheck') {
      const precheck = await precheckDraft(user.accessToken, payload, draftVersion, options);
      return privateResult({ action, draftVersion, precheck });
    }
    const saved = await saveDraft(user.accessToken, payload, draftVersion, options);
    return privateResult({ action, draftVersion, ...saved });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && ['CASE_ID_REQUIRED', 'INVALID_DRAFT_PAYLOAD', 'INVALID_DRAFT_VERSION'].includes(error.message))) {
      return fail({ code: 'INVALID_DRAFT', message: '病例资料格式无效，请重新打开草稿后重试。', retryable: false }, undefined, 400);
    }
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500;
    return fail(detail, undefined, status);
  }
}
