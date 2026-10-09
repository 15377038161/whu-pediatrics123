import { z } from 'zod';

/** 学生学习事件埋点校验（客户端上报 → 服务端校验 → RPC 幂等落库） */
export const engagementEventSchema = z.object({
  eventType: z.enum(['session_start', 'session_end', 'page_enter', 'page_leave', 'visibility_active', 'visibility_idle', 'heartbeat']),
  sessionId: z.string().uuid().nullable().optional(),
  clientEventId: z.string().min(8).max(128),
  tabId: z.string().min(8).max(128),
  // ⑤detail 白名单（与 RPC 侧 INVALID_DETAIL 校验一致）：仅允许 path 键，值长度 <= 256，
  // 杜绝夹带患者原文/token 等任意内容入库（客户端 SDK 层先拒绝，服务端 RPC 兜底二次校验）
  detail: z
    .object({ path: z.string().max(256) })
    .strict()
    .optional(),
});

export type EngagementEventInput = z.infer<typeof engagementEventSchema>;

/** ①严格日历日期：YYYY-MM-DD 且必须为真实存在的日期（拒绝 2026-02-31 等非法日期，避免 Postgres 500） */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.toISOString().slice(0, 10) === value;
  }, '日期不存在');

/**
 * 教师统计筛选参数（GET /api/teacher/usage-stats?from=...&to=...&userId=...&caseId=...&format=csv）
 * ①from <= to（起止顺序校验；跨范围直接 422，不给 RPC 层 500）
 */
export const usageStatsQuerySchema = z
  .object({
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    userId: z.string().uuid().optional(),
    caseId: z.string().trim().min(1).max(160).optional(),
    format: z.enum(['json', 'csv']).optional(),
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: '开始日期不能晚于结束日期',
    path: ['from'],
  });
