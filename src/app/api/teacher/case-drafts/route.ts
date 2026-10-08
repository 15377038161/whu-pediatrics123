import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist, normalizeDraftVersion, parseDraftPayload, precheckDraft, saveDraft } from '@/lib/case-draft-import';

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
    const user = await requireAuth(request);
    if (!user.accessToken) return fail({ code: 'AUTH_REQUIRED', message: '缺少访问令牌', retryable: false }, undefined, 401);
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
    if (!(await isTeacherByWhitelist(user.accessToken))) {
      return fail({ code: 'FORBIDDEN', message: '仅教师可访问病例草稿', retryable: false }, undefined, 403);
    }
    const { listDrafts } = await import('@/lib/case-draft-import');
    return ok(await listDrafts(user.accessToken));
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
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
      return ok({ action, draftVersion, precheck });
    }
    const saved = await saveDraft(user.accessToken, payload, draftVersion, options);
    return ok({ action, draftVersion, ...saved });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'CASE_ID_REQUIRED' || detail.code === 'INVALID_DRAFT_PAYLOAD' || detail.code === 'INVALID_DRAFT_VERSION' ? 400 : 403;
    return fail(detail, undefined, status);
  }
}
