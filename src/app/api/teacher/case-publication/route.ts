import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { getCasePublicationOverview, setCasePublication } from '@/lib/case-publication';

export const dynamic = 'force-dynamic';

/**
 * 教师单例上下架 API（仅教师）：
 * - GET  /api/teacher/case-publication  53 例目录发布状态对照（无行=已发布缺省开放）
 * - POST /api/teacher/case-publication  body: { caseId, published, reason? }
 *   下架插入/更新 published=false 行；重新上架置 true（保留行作审计痕迹）。
 *
 * 安全边界（与 case-drafts/case-import 路由同一模式）：
 * - 严格交集：应用层教师角色（requireAuth 'teacher'）AND 数据库白名单（app_is_teacher RPC）；
 * - 下架不删除 case_snapshot_facts/answers 原文，不触碰历史会话与成绩；
 * - 幂等初始化（facts/answers 导入）不写 case_publication，不重置下架决定；
 * - 学生守卫仅拦截新建会话与目录展示；既有会话恢复、教师访问不受影响。
 */

type TeacherContext = Awaited<ReturnType<typeof requireAuth>> & { accessToken: string; id: string };

async function requireTeacher(request: NextRequest): Promise<TeacherContext | Response> {
  const user = await requireAuth(request, 'teacher');
  if (!user.accessToken) return fail({ code: 'AUTH_REQUIRED', message: '缺少访问令牌', retryable: false }, undefined, 401);
  if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
  if (!(await isTeacherByWhitelist(user.accessToken))) {
    return fail({ code: 'FORBIDDEN', message: '仅教师可管理病例发布状态', retryable: false }, undefined, 403);
  }
  return { ...user, accessToken: user.accessToken, id: user.id };
}

export async function GET(request: NextRequest) {
  try {
    const gate = await requireTeacher(request);
    if (gate instanceof Response) return gate;
    const overview = await getCasePublicationOverview(gate.accessToken);
    return ok({
      total: overview.length,
      unpublished: overview.filter((row) => !row.published).length,
      cases: overview,
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireTeacher(request);
    if (gate instanceof Response) return gate;
    let body: { caseId?: unknown; published?: unknown; reason?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return fail({ code: 'INVALID_REQUEST', message: '请求体无效。', retryable: false }, undefined, 422);
    }
    if (typeof body.caseId !== 'string' || typeof body.published !== 'boolean') {
      return fail({ code: 'INVALID_REQUEST', message: 'caseId 与 published 为必填。', retryable: false }, undefined, 422);
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';
    const row = await setCasePublication(gate.accessToken, gate.id, body.caseId, body.published, reason);
    return ok({ caseId: row.caseId, published: row.published, updatedAt: row.updatedAt });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'CASE_NOT_FOUND' ? 404 : 500;
    return fail(detail, undefined, status);
  }
}
