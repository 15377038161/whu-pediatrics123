import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { engagementEventSchema } from '@/lib/engagement-schema';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient } from '@/lib/supabase-client';

/**
 * 学生学习事件上报（使用统计最小实现）：
 * - 服务端真实身份与时间：requireAuth 网络校验身份，时间戳由数据库 now() 生成（不信任客户端时钟）；
 * - 幂等：clientEventId 去重键经 RPC on conflict，重复上报返回 accepted=false 不双计；
 * - 有效时长：客户端只上报事件，区间由 engagement_record_event 服务端派生（隐藏页/挂机不计入）；
 * - 预览身份（provider=preview）不入库：演示数据与真实数据天然分离；
 * - 隐私：detail 仅存脱敏元数据（页面路径/事件类型），不含患者原文、对话内容、token。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    const parsed = engagementEventSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '事件数据无效。', retryable: false }, undefined, 422);
    }
    // ⑤detail 白名单已在 zod 严格模式（仅 path 键）+ RPC INVALID_DETAIL 双层校验，非法内容在此即被拒绝

    if (user.provider === 'preview') {
      // 预览演示身份：不污染真实统计（内存演示与生产数据分离）
      return ok({ accepted: true, persisted: false });
    }
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const db = getSupabaseUserClient(user.accessToken);
    const { eventType, sessionId, clientEventId, tabId, detail } = parsed.data;
    const { data, error } = await db.rpc('engagement_record_event', {
      p_event_type: eventType,
      p_session_id: sessionId ?? null,
      p_client_event_id: clientEventId,
      p_tab_id: tabId,
      p_detail: detail ?? {},
    });
    // PostgREST 错误是普通对象（message 字段携带 FORBIDDEN 等 code），归一化为 Error 后统一映射
    if (error) throw new Error(error.message || 'ENGAGEMENT_RPC_FAILED');
    // data=false：幂等命中（重复事件），accepted 语义如实返回
    return ok({ accepted: data === true, persisted: true });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 400);
  }
}
