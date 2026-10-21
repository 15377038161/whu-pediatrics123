import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/request-auth';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { fail, errorFromUnknown } from '@/lib/api-result';

export const runtime = 'nodejs';

/**
 * 病例文档解析预览（D08 收口后已废弃）：
 * 创建/导入入口收口，本路由不再接收文档上传；门控语义与收口前一致
 * （匿名 401 / 学生与非白名单教师 403 / 白名单教师 410 废弃响应），
 * 不读取请求体、不解析文档、不触碰草稿存储。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    if (!isDatabaseConfigured()) {
      return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库暂不可用，请稍后重试。', retryable: true }, undefined, 503);
    }
    if (!(await isTeacherByWhitelist(user.accessToken))) throw new Error('FORBIDDEN');
    return fail(
      {
        code: 'CASE_IMPORT_DEPRECATED',
        message: '病例创建与导入入口已收口，不再接收文档上传；历史草稿保留只读，资料问题请联系项目管理员登记处理。',
        retryable: false,
      },
      undefined,
      410,
    );
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(
      detail,
      undefined,
      detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500,
    );
  }
}
