import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionState } from '../src/domain/agent';
import { createInitialSession } from '../src/lib/agent-engine';
import { projectSessionForRole, projectSessionsForRole } from '../src/lib/session-projection';

/** 学生会话公开投影（防透题，任务1b）：
 *  学生 + active：caseOptions.sourceName 中性化、tests 剥离；
 *  教师与已完成会话不投影；无 caseOptions 会话原样返回。 */

function teacherSession(overrides?: Partial<SessionState>): SessionState {
  const session = createInitialSession('user-test', 'guided', 'teacher-川崎病');
  assert.ok(session.caseOptions, '教师病例会话应有 caseOptions');
  return { ...session, ...overrides };
}

test('学生 + active + 教师病例：sourceName 中性化且 tests 剥离', () => {
  const session = teacherSession();
  const projected = projectSessionForRole(session, 'student');
  assert.ok(projected.caseOptions);
  assert.ok(projected.caseOptions.sourceName.length > 1);
  assert.equal(projected.caseOptions.sourceName.includes('川崎'), false);
  assert.equal(projected.caseOptions.sourceName.includes('川崎'), false, '病种名不得进入学生响应');
  assert.equal(projected.caseOptions.tests.length, 0, '检查候选目录不下发');
  assert.equal(projected.caseOptions.exams.length, session.caseOptions!.exams.length, '查体目录保留');
  // 原始会话不被修改（纯函数投影）
  assert.ok(session.caseOptions!.sourceName.length > 0);
  assert.ok(session.caseOptions!.tests.length > 0 || session.caseOptions!.exams.length > 0);
});

test('教师角色：不投影（教师核对需要完整数据）', () => {
  const session = teacherSession();
  const projected = projectSessionForRole(session, 'teacher');
  assert.equal(projected, session, '教师响应原样返回');
});

test('已完成/报告待生成会话：不投影（复盘需要原始信息）', () => {
  for (const status of ['completed', 'report_pending'] as const) {
    const session = teacherSession({ status });
    const projected = projectSessionForRole(session, 'student');
    assert.equal(projected, session, `status=${status} 不投影`);
  }
});

test('无 caseOptions 会话（演示病例）：原样返回', () => {
  const session = createInitialSession('user-test', 'guided', 'peds-respiratory-001');
  assert.equal(session.caseOptions, undefined);
  const projected = projectSessionForRole(session, 'student');
  assert.equal(projected, session);
});

test('列表投影：逐条应用且保持顺序', () => {
  const active = teacherSession();
  const completed = teacherSession({ status: 'completed' });
  const list = projectSessionsForRole([active, completed], 'student');
  assert.equal(list.length, 2);
  assert.equal(list[0].caseOptions!.sourceName.includes('川崎'), false);
  assert.equal(list[1], completed, 'completed 原样');
});

test('投影不改变持久化语义：返回对象为浅拷贝（原 session 字段不被就地修改）', () => {
  const session = teacherSession();
  const originalSourceName = session.caseOptions!.sourceName;
  const originalTests = [...session.caseOptions!.tests];
  projectSessionForRole(session, 'student');
  assert.equal(session.caseOptions!.sourceName, originalSourceName);
  assert.deepEqual(session.caseOptions!.tests, originalTests);
});
