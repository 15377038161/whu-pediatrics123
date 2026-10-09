import { NextRequest, NextResponse } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { usageStatsQuerySchema } from '@/lib/engagement-schema';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, withDatabaseRetry } from '@/lib/supabase-client';
import { buildCsv } from '@/lib/usage-stats-csv';

/** 学生使用明细行（教师统计口径，练习成绩非正式成绩，输出须带标识） */
export interface StudentUsageRow {
  userId: string;
  displayName: string;
  studentNo: string;
  /** ⑥账号隔离标记：real=已确认真实 / unknown=历史无法判定（页面展示"未验证"徽标）；test 已在 RPC 层排除 */
  accountKind: 'real' | 'unknown';
  sessionCount: number;
  completedCount: number;
  abandonedCount: number;
  /** ③进行中：active 且 2 小时内有更新（时间客观口径，不再把进行中误计为"中途退出"） */
  inProgressCount: number;
  turnCount: number;
  activeHours: number;
  avgPracticeScore: number;
}

export interface UsageStatsResult {
  perStudent: StudentUsageRow[];
  overall: {
    studentCount: number;
    sessionCount: number;
    completedCount: number;
    inProgressCount: number;
    totalTurnCount: number;
    totalActiveHours: number;
  };
  /** ①日活趋势：北京时间自然日分桶（UTC+8，修复 UTC 0 点截断导致的跨日错归属） */
  dailyTrend: Array<{ date: string; activeStudents: number; sessions: number }>;
  /** ⑧周活趋势：北京时间自然周（周一起始） */
  weeklyTrend: Array<{ week: string; activeStudents: number; sessions: number }>;
  caseDistribution: Array<{ caseId: string; mode: string; sessionCount: number; completedCount: number }>;
  /** ⑧题库薄弱项：按病例+难度聚合正确率（样本 >= 3 且正确率 < 0.8） */
  weakAreas: Array<{ caseId: string; difficulty: string; assigned: number; correct: number; correctRate: number }>;
  /** ⑧单学生逐次训练明细（仅当查询参数 detailUserId 指定时返回，受限下钻；其余场景为空数组） */
  recentSessions: Array<{ sessionId: string; caseId: string; mode: string; statusKind: string; startedAt: string; turnCount: number; practiceScore: number }>;
  /** 练习成绩口径标识：非正式成绩，仅训练过程参考 */
  scoreBasis: 'practice-only';
}

/**
 * 教师使用统计（GET /api/teacher/usage-stats）：
 * - requireAuth('teacher')：学生调用 403，未登录 401（服务端身份，不信任客户端声明）；
 * - 统计范围由 teacher_stats_* RPC 内 app_is_teacher 白名单二次校验（fail-closed）；
 * - 筛选：from/to（严格日历日期，from<=to）、userId（学生）、caseId（病例，含时长口径）、
 *   detailUserId（单学生逐次训练下钻），全部可选；
 * - 导出：?format=csv 输出脱敏汇总（不含个人明文身份，公式注入防护）。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    const params = usageStatsQuerySchema.safeParse(query);
    if (!params.success) {
      return fail({ code: 'INVALID_REQUEST', message: '筛选参数无效（日期须为合法日历日期，且开始不晚于结束）。', retryable: false }, undefined, 422);
    }
    if (user.provider === 'preview') {
      // 预览身份无真实数据库统计：诚实空态（不伪造演示数据）
      const empty: UsageStatsResult = {
        perStudent: [],
        overall: { studentCount: 0, sessionCount: 0, completedCount: 0, inProgressCount: 0, totalTurnCount: 0, totalActiveHours: 0 },
        dailyTrend: [],
        weeklyTrend: [],
        caseDistribution: [],
        weakAreas: [],
        recentSessions: [],
        scoreBasis: 'practice-only',
      };
      return ok(empty);
    }
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const db = getSupabaseUserClient(user.accessToken);
    const rpcArgs = {
      p_from_date: params.data.from ?? null,
      p_to_date: params.data.to ?? null,
      p_user_id: params.data.userId ?? null,
      p_case_id: params.data.caseId ?? null,
    };
    const load = async () => Promise.all([
      db.rpc('teacher_stats_per_student', rpcArgs),
      db.rpc('teacher_stats_overall', rpcArgs),
      db.rpc('teacher_stats_daily_trend', rpcArgs),
      db.rpc('teacher_stats_weekly_trend', rpcArgs),
      db.rpc('teacher_stats_case_distribution', rpcArgs),
      db.rpc('teacher_stats_weak_areas', { p_from_date: rpcArgs.p_from_date, p_to_date: rpcArgs.p_to_date, p_user_id: rpcArgs.p_user_id, p_min_samples: 3 }),
    ]);
    const [perStudent, overall, dailyTrend, weeklyTrend, caseDistribution, weakAreas] = await withDatabaseRetry(load);
    // PostgREST 错误是普通对象（message 携带 FORBIDDEN 等 code），归一化为 Error 后统一映射
    if (perStudent.error) throw new Error(perStudent.error.message || 'STATS_RPC_FAILED');
    if (overall.error) throw new Error(overall.error.message || 'STATS_RPC_FAILED');
    if (dailyTrend.error) throw new Error(dailyTrend.error.message || 'STATS_RPC_FAILED');
    if (weeklyTrend.error) throw new Error(weeklyTrend.error.message || 'STATS_RPC_FAILED');
    if (caseDistribution.error) throw new Error(caseDistribution.error.message || 'STATS_RPC_FAILED');
    if (weakAreas.error) throw new Error(weakAreas.error.message || 'STATS_RPC_FAILED');

    // ⑧受限下钻：仅当显式指定 detailUserId 时查询该学生逐次训练明细
    let recentSessions: UsageStatsResult['recentSessions'] = [];
    const detailUserId = request.nextUrl.searchParams.get('detailUserId');
    if (detailUserId) {
      const detail = await db.rpc('teacher_stats_recent_sessions', { p_user_id: detailUserId, p_limit: 50 });
      if (detail.error) throw new Error(detail.error.message || 'STATS_RPC_FAILED');
      recentSessions = (detail.data ?? []) as UsageStatsResult['recentSessions'];
    }

    const result: UsageStatsResult = {
      perStudent: (perStudent.data ?? []) as StudentUsageRow[],
      overall: (overall.data ?? {}) as UsageStatsResult['overall'],
      dailyTrend: (dailyTrend.data ?? []) as UsageStatsResult['dailyTrend'],
      weeklyTrend: (weeklyTrend.data ?? []) as UsageStatsResult['weeklyTrend'],
      caseDistribution: (caseDistribution.data ?? []) as UsageStatsResult['caseDistribution'],
      weakAreas: (weakAreas.data ?? []) as UsageStatsResult['weakAreas'],
      recentSessions,
      scoreBasis: 'practice-only',
    };
    if (params.data.format === 'csv') {
      return new NextResponse(buildCsv(result), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="usage-stats-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return ok(result);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'INVALID_DATE_RANGE' ? 422 : 500);
  }
}
