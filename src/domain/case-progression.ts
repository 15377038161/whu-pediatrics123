/**
 * 系统内关卡解锁规则（顶层不设锁，只在某个系统内部生效）。
 *
 * 口径：
 * - 已完成的病例可回看；
 * - 进行中的病例可续做；
 * - 第一个「未完成」的病例即当前可挑战的关卡；
 * - 更靠后的病例未解锁，完成后逐关推进。
 *
 * 纯函数、无副作用：输入病例顺序与会话状态，输出每关的展示状态，
 * 便于对「跨分类连续编号」「全部完成后全开」等边界做确定性测试。
 */

export type ProgressionSession = { id: string; caseId: string; status: string };

export type LevelLock = {
  caseId: string;
  level: number;
  completed: boolean;
  ongoing: boolean;
  unlocked: boolean;
};

export function buildLevelLocks(caseIds: string[], sessions: ProgressionSession[]): LevelLock[] {
  const completedCaseIds = new Set(sessions.filter((session) => session.status === 'completed').map((session) => session.caseId));
  const activeCaseIds = new Set(sessions.filter((session) => session.status === 'active').map((session) => session.caseId));
  const firstPendingIndex = caseIds.findIndex((caseId) => !completedCaseIds.has(caseId));

  return caseIds.map((caseId, index) => {
    const completed = completedCaseIds.has(caseId);
    const ongoing = activeCaseIds.has(caseId);
    const unlocked = ongoing || completed || firstPendingIndex === -1 || index === firstPendingIndex;
    return { caseId, level: index + 1, completed, ongoing, unlocked };
  });
}