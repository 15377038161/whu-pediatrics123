import { z } from 'zod';
import type { ClassLeaderboard } from '@/domain/classroom';
import { resolveCaseId } from '@/lib/case-identity';
import { getTeacherSourceId } from '@/lib/teacher-case-data';

/** RPC 只返回班内学生及“学生 × 病例”的最高有效临床分，不返回报告正文或分病例证据。 */
export const classLeaderboardDataSchema = z.object({
  members: z.array(z.object({
    userId: z.string().uuid(),
    name: z.string().trim().min(1),
  })),
  scores: z.array(z.object({
    userId: z.string().uuid(),
    caseId: z.string().min(1),
    score: z.number().int().min(0).max(100),
  })),
});

/**
 * 积分榜口径：公开 UUID/内部病例 ID 先归一，再按 sourceId 合并别名与亚型；
 * 每个来源病例只取最高临床过程分，总和为积分。同分采用竞赛排名（1、1、3）。
 * 病历书写分不在 training_reports 中，未评分报告由 RPC 排除，均不参与这里。
 */
export function buildClassLeaderboard(classId: string, input: unknown): ClassLeaderboard {
  const { members, scores } = classLeaderboardDataSchema.parse(input);
  const byStudent = new Map(members.map((member) => [member.userId, {
    name: member.name,
    bestBySource: new Map<string, number>(),
  }]));

  for (const row of scores) {
    const student = byStudent.get(row.userId);
    if (!student) continue;
    const sourceId = getTeacherSourceId(resolveCaseId(row.caseId));
    student.bestBySource.set(sourceId, Math.max(student.bestBySource.get(sourceId) ?? 0, row.score));
  }

  const sorted = [...byStudent.entries()].map(([userId, student]) => ({
    userId,
    name: student.name,
    points: [...student.bestBySource.values()].reduce((sum, score) => sum + score, 0),
    sourceCount: student.bestBySource.size,
    rank: 0,
  })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'zh-CN') || a.userId.localeCompare(b.userId));

  let previousPoints: number | null = null;
  let previousRank = 0;
  const entries = sorted.map((entry, index) => {
    const rank = entry.points === previousPoints ? previousRank : index + 1;
    previousPoints = entry.points;
    previousRank = rank;
    return { ...entry, rank };
  });

  return { classId, scoreBasis: 'clinical_process', tieRule: 'competition', entries };
}
