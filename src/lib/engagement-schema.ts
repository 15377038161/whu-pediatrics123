import { z } from 'zod';

/** 学生学习事件埋点校验（客户端上报 → 服务端校验 → RPC 幂等落库） */
export const engagementEventSchema = z.object({
  eventType: z.enum(['session_start', 'session_end', 'page_enter', 'page_leave', 'visibility_active', 'visibility_idle', 'heartbeat']),
  sessionId: z.string().uuid().nullable().optional(),
  clientEventId: z.string().min(8).max(128),
  tabId: z.string().min(8).max(128),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export type EngagementEventInput = z.infer<typeof engagementEventSchema>;

/** 教师统计筛选参数（GET /api/teacher/usage-stats?from=...&to=...&userId=...&caseId=...&format=csv） */
export const usageStatsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.string().uuid().optional(),
  caseId: z.string().trim().min(1).max(160).optional(),
  format: z.enum(['json', 'csv']).optional(),
});
