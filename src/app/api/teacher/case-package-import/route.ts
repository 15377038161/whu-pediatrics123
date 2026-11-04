import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import {
  controlledCasePackageMetadata,
  inspectControlledCasePackage,
  parseControlledCaseImportRequest,
  verifyControlledCaseImport,
} from '@/lib/controlled-case-package';
import { requireAuth } from '@/lib/request-auth';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { diagnoseTeacherCaseImport, importTeacherCases } from '@/lib/teacher-case-import';

export const dynamic = 'force-dynamic';

type TeacherContext = Awaited<ReturnType<typeof requireAuth>> & { accessToken: string };

async function requireTeacher(request: NextRequest): Promise<TeacherContext | Response> {
  const user = await requireAuth(request, 'teacher');
  if (!user.accessToken) return fail({ code: 'AUTH_REQUIRED', message: '缺少访问令牌', retryable: false }, undefined, 401);
  if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
  if (!(await isTeacherByWhitelist(user.accessToken))) {
    return fail({ code: 'FORBIDDEN', message: '仅白名单教师可执行受控病例包导入', retryable: false }, undefined, 403);
  }
  return { ...user, accessToken: user.accessToken };
}

function routeError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('AUTH_REQUIRED')) return fail({ code: 'AUTH_REQUIRED', message: '请先登录。', retryable: false }, undefined, 401);
  if (message.includes('FORBIDDEN')) return fail({ code: 'FORBIDDEN', message: '你无权执行该操作。', retryable: false }, undefined, 403);
  if (message.includes('DATABASE_NOT_CONFIGURED')) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
  if (message.includes('CASE_PACKAGE_CHANGED')) {
    return fail({ code: 'CASE_PACKAGE_CHANGED', message: '受控病例包已变化，请刷新校验后再操作。', retryable: true }, undefined, 409);
  }
  if (message.includes('CASE_PACKAGE_INVALID')) {
    return fail({ code: 'CASE_PACKAGE_INVALID', message: '服务器固定病例包未通过完整性或 schema 校验，已阻止导入。', retryable: false }, undefined, 503);
  }
  if (message.includes('INVALID_REQUEST')) return fail({ code: 'INVALID_REQUEST', message: '请求参数无效。', retryable: false }, undefined, 400);
  const detail = errorFromUnknown(error);
  return fail(detail, undefined, detail.code === 'INTERNAL_ERROR' ? 500 : 400);
}

/** Read-only package preflight and current exact-version diagnostics; no patient content is returned. */
export async function GET(request: NextRequest) {
  try {
    const gate = await requireTeacher(request);
    if (gate instanceof Response) return gate;
    const controlledPackage = inspectControlledCasePackage();
    const diagnostic = await diagnoseTeacherCaseImport(gate.accessToken);
    return ok({ package: controlledCasePackageMetadata(controlledPackage), diagnostic });
  } catch (error) {
    return routeError(error);
  }
}

/**
 * Fixed-package import only. The client supplies a fingerprint and optional catalog IDs,
 * never a path, SQL, file, or patient payload. Writes and readback use the teacher JWT under RLS.
 */
export async function POST(request: NextRequest) {
  try {
    const gate = await requireTeacher(request);
    if (gate instanceof Response) return gate;
    const controlledPackage = inspectControlledCasePackage();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail({ code: 'INVALID_REQUEST', message: '请求正文必须是 JSON 对象。', retryable: false }, undefined, 400);
    }
    const input = parseControlledCaseImportRequest(body, controlledPackage);
    const summary = await importTeacherCases(gate.accessToken, input);
    let verification;
    try {
      verification = await verifyControlledCaseImport(gate.accessToken, summary, controlledPackage);
    } catch {
      return fail({
        code: 'CASE_IMPORT_VERIFY_UNAVAILABLE',
        message: '导入已执行，但双表回读暂不可用；请使用同一包指纹安全重试并核对逐例状态。',
        retryable: true,
      }, undefined, 503);
    }
    return ok({
      package: controlledCasePackageMetadata(controlledPackage),
      summary: {
        total: summary.total,
        imported: summary.imported,
        unchanged: summary.unchanged,
        skipped: summary.skipped,
        failed: summary.failed,
      },
      verification,
    });
  } catch (error) {
    return routeError(error);
  }
}
