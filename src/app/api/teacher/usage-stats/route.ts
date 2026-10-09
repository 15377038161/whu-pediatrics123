import { NextRequest, NextResponse } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { usageStatsQuerySchema } from '@/lib/engagement-schema';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, withDatabaseRetry } from '@/lib/supabase-client';

/** 学生使用明细行（教师统计口径，练习成绩非正式成绩，输出须带标识） */
export interface StudentUsageRow {
  userId: string;
  displayName: string;
  studentNo: string;
  sessionCount: number;
  completedCount: number;
  abandonedCount: number;
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
    totalTurnCount: number;
    totalActiveHours: number;
  };
  dailyTrend: Array<{ date: string; activeStudents: number; sessions: number }>;
  caseDistribution: Array<{ caseId: string; mode: string; sessionCount: number; completedCount: number }>;
  /** 练习成绩口径标识：非正式成绩，仅训练过程参考 */
  scoreBasis: 'practice-only';
}

/** 脱敏显示名：姓名保留姓 + **；学号保留前 4 位 + ***（教师本人在页面可见明文，导出统一脱敏） */
function maskName(name: string): string {
  if (!name) return '(未命名)';
  if (name.length <= 1) return `${name}*`;
  return `${name.slice(0, 1)}${'*'.repeat(Math.min(name.length - 1, 2))}`;
}

function maskStudentNo(no: string): string {
  if (!no) return '';
  return no.length <= 4 ? `${no}***` : `${no.slice(0, 4)}***`;
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 脱敏汇总导出 CSV：仅聚合统计与学生级汇总（脱敏身份），不含 user_id 明文、对话内容、患者数据 */
function buildCsv(result: UsageStatsResult): string {
  const lines: string[] = [];
  lines.push('# 学生使用统计（脱敏导出）');
  lines.push('# 有效时长口径：页面可见且活跃（隐藏页/多标签非当前页/挂机不计入）；练习成绩为训练过程参考，非正式成绩');
  lines.push(csvEscape('汇总'));
  lines.push(['去重学生数', '训练总数', '完成数', '总轮次', '有效活跃小时'].map(csvEscape).join(','));
  lines.push([result.overall.studentCount, result.overall.sessionCount, result.overall.completedCount, result.overall.totalTurnCount, result.overall.totalActiveHours].map(csvEscape).join(','));
  lines.push('');
  lines.push(csvEscape('学生明细（脱敏）'));
  lines.push(['学生(脱敏)', '学号(脱敏)', '训练次数', '完成次数', '中途退出', '轮次', '有效时长(h)', '平均练习分(非正式)'].map(csvEscape).join(','));
  for (const row of result.perStudent) {
    lines.push([maskName(row.displayName), maskStudentNo(row.studentNo), row.sessionCount, row.completedCount, row.abandonedCount, row.turnCount, row.activeHours, row.avgPracticeScore].map(csvEscape).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}

/**
 * 教师使用统计（GET /api/teacher/usage-stats）：
 * - requireAuth('teacher')：学生调用 403，未登录 401（服务端身份，不信任客户端声明）；
 * - 统计范围由 teacher_stats_* RPC 内 app_is_teacher 白名单二次校验（fail-closed）；
 * - 筛选：from/to（日期）、userId（学生）、caseId（病例），全部可选；
 * - 导出：?format=csv 输出脱敏汇总（不含个人明文身份）。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    const params = usageStatsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!params.success) {
      return fail({ code: 'INVALID_REQUEST', message: '筛选参数无效。', retryable: false }, undefined, 422);
    }
    if (user.provider === 'preview') {
      // 预览身份无真实数据库统计：诚实空态（不伪造演示数据）
      const empty: UsageStatsResult = {
        perStudent: [],
        overall: { studentCount: 0, sessionCount: 0, completedCount: 0, totalTurnCount: 0, totalActiveHours: 0 },
        dailyTrend: [],
        caseDistribution: [],
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
      db.rpc('teacher_stats_case_distribution', { p_from_date: rpcArgs.p_from_date, p_to_date: rpcArgs.p_to_date, p_user_id: rpcArgs.p_user_id }),
    ]);
    const [perStudent, overall, dailyTrend, caseDistribution] = await withDatabaseRetry(load);
    // PostgREST 错误是普通对象（message 携带 FORBIDDEN 等 code），归一化为 Error 后统一映射
    if (perStudent.error) throw new Error(perStudent.error.message || 'STATS_RPC_FAILED');
    if (overall.error) throw new Error(overall.error.message || 'STATS_RPC_FAILED');
    if (dailyTrend.error) throw new Error(dailyTrend.error.message || 'STATS_RPC_FAILED');
    if (caseDistribution.error) throw new Error(caseDistribution.error.message || 'STATS_RPC_FAILED');
    const result: UsageStatsResult = {
      perStudent: (perStudent.data ?? []) as StudentUsageRow[],
      overall: (overall.data ?? {}) as UsageStatsResult['overall'],
      dailyTrend: (dailyTrend.data ?? []) as UsageStatsResult['dailyTrend'],
      caseDistribution: (caseDistribution.data ?? []) as UsageStatsResult['caseDistribution'],
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
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}
