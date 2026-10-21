import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { diagnoseTeacherCaseImport } from '@/lib/teacher-case-import';

export const dynamic = 'force-dynamic';

/**
 * 教师病例导入 API（D08 收口后）：
 * - GET  /api/teacher/case-import  来源覆盖/版本诊断（只读：本地 53 JSON 版本指纹 vs DB 导入版本对照，
 *   loaded/pending/missing_local/no_source 状态枚举 + 教师侧健康计数；不含任何患者原文/密钥/内部路径）
 * - POST /api/teacher/case-import  已废弃：批量导入写路径收口，返回 410 废弃响应
 *
 * 安全边界（与 case-drafts 路由同一模式）：
 * - 严格交集：应用层教师角色（requireAuth 'teacher'）AND 数据库白名单
 *   （app_is_teacher RPC），非 OR、非仅白名单；
 * - 病例目录由平台统一维护，教师侧不再提供创建/导入入口；
 * - 数据库侧教师 RLS 兜底，匿名/学生直接 Data API 读写均被 RLS 拒绝。
 */

type TeacherContext = Awaited<ReturnType<typeof requireAuth>> & { accessToken: string };

async function requireTeacher(request: NextRequest): Promise<TeacherContext | Response> {
  const user = await requireAuth(request, 'teacher');
  if (!user.accessToken) return fail({ code: 'AUTH_REQUIRED', message: '缺少访问令牌', retryable: false }, undefined, 401);
  if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
  if (!(await isTeacherByWhitelist(user.accessToken))) {
    return fail({ code: 'FORBIDDEN', message: '仅教师可访问病例导入', retryable: false }, undefined, 403);
  }
  return { ...user, accessToken: user.accessToken };
}

export async function GET(request: NextRequest) {
  try {
    const gate = await requireTeacher(request);
    if (gate instanceof Response) return gate;
    const diagnostic = await diagnoseTeacherCaseImport(gate.accessToken);
    return ok(diagnostic);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireTeacher(request);
    if (gate instanceof Response) return gate;
    return fail(
      {
        code: 'CASE_IMPORT_DEPRECATED',
        message: '病例批量导入入口已收口，现行病例目录由平台统一维护；本接口仅保留只读诊断，资料问题请联系项目管理员登记处理。',
        retryable: false,
      },
      undefined,
      410,
    );
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : 403;
    return fail(detail, undefined, status);
  }
}
