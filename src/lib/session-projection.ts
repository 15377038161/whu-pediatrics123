import type { AppRole, SessionState } from '@/domain/agent';
import { findPublicCase, publicCaseId } from '@/lib/case-identity';
import { verifiedComplaint } from '@/lib/case-admission';
import { readTeacherCaseData } from '@/lib/teacher-case-data';
import {sessionTeachingPackage} from '@/lib/session-teaching';
import {GROWTH_TOOLS} from '@/domain/growth-exam';

/**
 * 学生会话公开投影（防透题，2026-10-12 第一批任务1）：
 *
 * 服务端在响应边界统一收敛建会话/读取/恢复/列表/事件返回路径的学生可见字段，
 * 内部完整状态（repository.getSession → runAgentTurn）不受影响：
 *
 * - 所有角色的响应使用稳定公开caseId，内部持久化ID不变；教师完整字段保留。
 * - 教师（role=teacher）与已完成/报告待生成（status≠active）会话不裁减事实字段——
 *   教师核对需要完整数据，已完成会话进入复盘（报告已含原病例诊断与诊疗经过对照）。
 * - 学生 + 进行中（active）会话：
 *   1. caseOptions.sourceName 中性化——替换为公开目录中性标题（学科+序号），
 *      病种名/教师来源名称不进入学生响应（完成后经报告 caseTitle 释放）；
 *   2. caseOptions.tests 剥离——未完成训练不下发检查候选目录（配套任务2：
 *      辅助检查改为学生自主文本输入，服务端确定性匹配，客户端无需候选列表）；
 *   3. exams 剥离器材-正确部位映射；工作台使用与器材无关的中性解剖部位。
 *
 * 只过滤响应投影，不修改持久化状态（投影是纯函数，原始 state 落库不变）。
 */
export function projectSessionForRole(session: SessionState, role: AppRole): SessionState {
  const publicSession = { ...session, caseId: publicCaseId(session.caseId) };
  const pack=sessionTeachingPackage(session);
  // Completed feedback has its own report/ownership gate; never return it in training events.
  delete publicSession.postVisitReview;
  if(publicSession.caseOptions&&pack&&GROWTH_TOOLS.every(tool=>pack.exams.some(exam=>exam.toolId===tool&&exam.bodyPartId==='growth'))){
    publicSession.caseOptions={...publicSession.caseOptions,growthMeasurements:true};
  }
  // 工作台目录按公开ID查人物配置；教师响应也必须统一ID，避免合法病例被当成退役记录。
  if (role === 'teacher') return publicSession;
  delete publicSession.supplementalTests;
  // 创建指纹包含服务端原病例ID，仅用于幂等核对，不能作为公开会话字段。
  delete publicSession.creationRequest;
  delete publicSession.dialogueMemory;
  delete publicSession.testRequests;
  if (session.status !== 'active') return publicSession;
  if (!session.caseOptions) return publicSession;
  const profile = findPublicCase(session.caseId);
  const complaint = verifiedComplaint(readTeacherCaseData(session.caseId, session.sourceSnapshotVersion, session.id));
  return {
    ...publicSession,
    caseId: publicCaseId(session.caseId),
    caseOptions: {
      ...(publicSession.caseOptions ?? session.caseOptions),
      sourceName: complaint ?? profile?.title ?? '真实教学病例',
      complaint: complaint ?? undefined,
      tests: [],
      exams: [],
    },
  };
}

/** 列表投影（逐条应用，保持顺序）。 */
export function projectSessionsForRole(sessions: SessionState[], role: AppRole): SessionState[] {
  return sessions.map((session) => projectSessionForRole(session, role));
}
