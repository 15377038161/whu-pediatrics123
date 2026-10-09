/**
 * 题库判分两支合成单测（2026-10-10）：
 * 本测试将 quiz_submit_answer RPC（迁移 20261008150000）的判分语义镜像为 TS 实现，
 * 验证两支判分（正确/错误）与幂等不覆盖语义。
 * 边界如实标注：
 * - 这是 SQL 逻辑的 TS 镜像验证，不是真实 SQL 执行；
 * - 真实 SQL 执行由真实 HTTP 验收覆盖（scripts/verify-quiz-answer.ts，实际覆盖
 *   correct=false 分支；correct=true 分支未在真实 HTTP 中覆盖，由本合成测试补齐语义）；
 * - SQL 定义若后续修改，本镜像测试需同步（迁移文件为本测试的对照来源）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** 镜像迁移 20261008150000 中 quiz_submit_answer 的核心语义。 */
interface AssignmentRow {
  questionId: string;
  userId: string;
  submittedAnswer: string | null;
  isCorrect: boolean | null;
  answeredAt: Date | null;
}
interface QuestionRow { id: string; answer: string; explanation: string }

function mirrorSubmitAnswer(params: {
  questions: Map<string, QuestionRow>;
  assignments: Map<string, AssignmentRow>; // key: `${userId}:${questionId}`
  userId: string;
  questionId: string;
  answer: string;
}): { correct?: boolean; answer?: string; explanation?: string; alreadyAnswered?: boolean; submittedAnswer?: string; error?: string } {
  const { questions, assignments, userId, questionId, answer } = params;
  const assigned = assignments.get(`${userId}:${questionId}`);
  // 归属校验：题目必须已分配给本人
  if (!assigned) return { error: 'NOT_ASSIGNED' };
  const question = questions.get(questionId);
  if (!question) return { error: 'NOT_FOUND' };
  // 已作答：返回首次记录结果，不覆盖、不刷分
  if (assigned.answeredAt !== null) {
    return {
      correct: assigned.isCorrect ?? false,
      answer: question.answer,
      explanation: question.explanation,
      alreadyAnswered: true,
      submittedAnswer: assigned.submittedAnswer ?? undefined,
    };
  }
  // 首次作答：原子写入（is_correct = (p_answer = v_answer)）
  const correct = answer === question.answer;
  assigned.submittedAnswer = answer;
  assigned.isCorrect = correct;
  assigned.answeredAt = new Date();
  return { correct, answer: question.answer, explanation: question.explanation, alreadyAnswered: false };
}

function setup(): { questions: Map<string, QuestionRow>; assignments: Map<string, AssignmentRow> } {
  const questions = new Map<string, QuestionRow>([
    ['q1', { id: 'q1', answer: '选项B', explanation: '解析1' }],
    ['q2', { id: 'q2', answer: '选项C', explanation: '解析2' }],
  ]);
  const assignments = new Map<string, AssignmentRow>([
    ['userA:q1', { questionId: 'q1', userId: 'userA', submittedAnswer: null, isCorrect: null, answeredAt: null }],
    ['userA:q2', { questionId: 'q2', userId: 'userA', submittedAnswer: null, isCorrect: null, answeredAt: null }],
  ]);
  return { questions, assignments };
}

test('判分支一：提交正确选项 → correct=true（真实 HTTP 未覆盖此分支，由本合成测试补齐语义）', () => {
  const state = setup();
  const r = mirrorSubmitAnswer({ ...state, userId: 'userA', questionId: 'q1', answer: '选项B' });
  assert.equal(r.correct, true, '正确选项应判 true');
  assert.equal(r.alreadyAnswered, false);
  assert.equal(r.answer, '选项B', '作答后才返回答案');
  assert.equal(r.explanation, '解析1');
});

test('判分支二：提交错误选项 → correct=false（真实 HTTP 已实测覆盖此分支）', () => {
  const state = setup();
  const r = mirrorSubmitAnswer({ ...state, userId: 'userA', questionId: 'q2', answer: '选项A' });
  assert.equal(r.correct, false, '错误选项应判 false');
  assert.equal(r.alreadyAnswered, false);
  assert.equal(r.answer, '选项C', '错误作答后仍返回正确答案供学习');
});

test('幂等：首次错误后重复提交正确选项 → 保持 false 不改分不覆盖', () => {
  const state = setup();
  const first = mirrorSubmitAnswer({ ...state, userId: 'userA', questionId: 'q2', answer: '选项A' });
  assert.equal(first.correct, false);
  const second = mirrorSubmitAnswer({ ...state, userId: 'userA', questionId: 'q2', answer: '选项C' });
  assert.equal(second.alreadyAnswered, true, '重复提交标记已作答');
  assert.equal(second.correct, false, '重复提交不改分（保持首次 false）');
  assert.equal(second.submittedAnswer, '选项A', '重复提交不覆盖首次选项');
});

test('幂等：首次正确后重复提交错误选项 → 保持 true 不改分', () => {
  const state = setup();
  const first = mirrorSubmitAnswer({ ...state, userId: 'userA', questionId: 'q1', answer: '选项B' });
  assert.equal(first.correct, true);
  const second = mirrorSubmitAnswer({ ...state, userId: 'userA', questionId: 'q1', answer: '选项D' });
  assert.equal(second.alreadyAnswered, true);
  assert.equal(second.correct, true, '重复提交不改分（保持首次 true）');
  assert.equal(second.submittedAnswer, '选项B', '重复提交不覆盖首次选项');
});

test('归属校验：未分配题目作答 → NOT_ASSIGNED（真实 HTTP 已实测 403）', () => {
  const state = setup();
  state.assignments.delete('userA:q2');
  const r = mirrorSubmitAnswer({ ...state, userId: 'userA', questionId: 'q2', answer: '选项C' });
  assert.equal(r.error, 'NOT_ASSIGNED');
  assert.equal(r.answer, undefined, '未分配作答不返回答案');
});

test('跨账号：他人分配的题目作答 → NOT_ASSIGNED（真实 HTTP 已实测双身份拒绝）', () => {
  const state = setup();
  const r = mirrorSubmitAnswer({ ...state, userId: 'userB', questionId: 'q1', answer: '选项B' });
  assert.equal(r.error, 'NOT_ASSIGNED', 'userB 无 q1 分配记录，归属校验拒绝');
});
