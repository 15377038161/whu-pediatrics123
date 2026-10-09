import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { importTeacherCases, diagnoseTeacherCaseImport } from '@/lib/teacher-case-import';

export const dynamic = 'force-dynamic';

/**
 * 教师病例导入 API（仅教师）：
 * - GET  /api/teacher/case-import  来源覆盖/版本诊断（本地 53 JSON 版本指纹 vs DB 导入版本对照，
 *   loaded/pending/missing_local/no_source 状态枚举 + 教师侧健康计数；不含任何患者原文/密钥/内部路径）
 * - POST /api/teacher/case-import  body: { only?: string[] }
 *   服务端读取本地受控交接产物 knowledge/teaching-cases/*.json（教师已审核，
 *   gitignored 不入库），经 recordSchema 校验与 sha256 版本指纹计算后，
 *   以教师身份双写 case_snapshot_facts + case_snapshot_answers 持久缓存。
 *
 * 安全边界（与 case-drafts 路由同一模式）：
 * - 严格交集：应用层教师角色（requireAuth 'teacher'）AND 数据库白名单
 *   （app_is_teacher RPC），非 OR、非仅白名单；
 * - 病例内容全部来自服务端本地文件，客户端请求体仅可选病例 ID 过滤列表，
 *   零患者原文上传、零 role 自填；
 * - 写库走教师身份用户客户端，RLS 兜底拒绝匿名/学生；
 * - upsert ignoreDuplicates：同版本幂等，不覆盖既有装载、不替换完整事实；
 * - 实际导入需真实教师登录态：本路由就绪 ≠ 已导入（当前 53 例尚未持久化）。
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
    let only: string[] | undefined;
    try {
      const body = (await request.json()) as { only?: unknown };
      if (Array.isArray(body.only)) only = body.only.filter((item): item is string => typeof item === 'string').slice(0, 100);
    } catch {
      // 空请求体合法：全量导入
    }
    const summary = await importTeacherCases(gate.accessToken, { only });
    return ok({
      summary: {
        total: summary.total,
        imported: summary.imported,
        unchanged: summary.unchanged,
        skipped: summary.skipped,
        failed: summary.failed,
      },
      // 仅返回 caseId+状态+版本指纹，不回传任何患者事实内容
      results: summary.results.map((item) => ({ caseId: item.caseId, status: item.status, version: item.version ?? null })),
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : 403;
    return fail(detail, undefined, status);
  }
}
