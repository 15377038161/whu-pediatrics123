import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { listSkillCatalog } from '@/lib/learning-resource';


export const dynamic = 'force-dynamic';


/**
 * 技能学习目录（批次7，GET /api/skills）：
 * 学生/教师通用（requireAuth 不限角色）。学生视角含可见资源数与本人完成数
 * （skill_catalog_student 受控 RPC，可见性谓词与资源列表同源）；教师端绑定下拉只取基础字段。
 * 完成度仅展示，不当掌握程度、不入临床评分。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const db = getSupabaseUserClient(user.accessToken);
    return ok({ skills: await listSkillCatalog(db) });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}
