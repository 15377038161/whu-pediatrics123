import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRepository,
  buildCaseProgress,
  teacherCaseMeta,
  type TeacherStudentProfileEntry,
} from '../src/lib/repository';
import { CASE_PUBLIC_IDS } from '../src/lib/case-identity';
import { TEACHER_CASE_CATALOG, CASE_INDEX_NUMBER } from '../src/domain/teacher-case-catalog';
import { createInitialSession } from '../src/lib/agent-engine';

const resolver = (caseId: string) => ({ caseLabel: `病名:${caseId}`, indexNumber: 3 });

const baseEntry = (overrides: Partial<TeacherStudentProfileEntry> & { sessionId: string }): TeacherStudentProfileEntry => ({
  mode: 'osce',
  startedAt: '2026-01-01T08:00:00Z',
  updatedAt: '2026-01-01T08:00:00Z',
  caseId: 'teacher-A',
  status: 'completed',
  reportId: 'r1',
  totalScore: 88,
  scoreBasis: 'clinical',
  ...overrides,
});

test('批次3·病例进度聚合：分组/计数/最近得分/排序全契约（纯函数）', () => {
  const entries = [
    baseEntry({ sessionId: 's1', caseId: 'teacher-A', status: 'completed', reportId: 'r1', totalScore: 90, updatedAt: '2026-01-02T08:00:00Z', startedAt: '2026-01-02T07:00:00Z' }),
    baseEntry({ sessionId: 's2', caseId: 'teacher-A', status: 'report_pending', reportId: 'r2', totalScore: 70, updatedAt: '2026-01-03T08:00:00Z', startedAt: '2026-01-03T07:00:00Z' }),
    baseEntry({ sessionId: 's6', caseId: 'teacher-A', status: 'completed', reportId: null, totalScore: null, updatedAt: '2026-01-07T08:00:00Z', startedAt: '2026-01-07T07:00:00Z' }),
    baseEntry({ sessionId: 's3', caseId: 'teacher-B', status: 'active', reportId: null, totalScore: null, updatedAt: '2026-01-04T08:00:00Z', startedAt: '2026-01-04T07:00:00Z' }),
    baseEntry({ sessionId: 's4', caseId: null, status: 'completed', reportId: 'r4', totalScore: 95, updatedAt: '2026-01-05T08:00:00Z', startedAt: '2026-01-05T07:00:00Z' }),
    baseEntry({ sessionId: 's5', caseId: '   ', status: null, reportId: null, totalScore: null, updatedAt: '2026-01-06T08:00:00Z', startedAt: '2026-01-06T07:00:00Z' }),
  ];
  const progress = buildCaseProgress(entries, resolver);
  assert.equal(progress.length, 3, 'teacher-A/teacher-B/未标注 三组');

  const groupA = progress.find((group) => group.caseId === 'teacher-A');
  assert.ok(groupA);
  assert.equal(groupA.caseLabel, '病名:teacher-A');
  assert.equal(groupA.indexNumber, 3);
  assert.equal(groupA.trainCount, 3, 'A 组 3 次训练');
  assert.equal(groupA.completedCount, 2, 'completed 仅计 status=completed（s1/s6）');
  assert.equal(groupA.reportCount, 2, '报告数计 reportId 非空（r1/r2）');
  assert.equal(groupA.latestScore, 70, '最近已评分取 updatedAt 最新的 s2（s6 无分不计）');
  assert.equal(groupA.latestAt, '2026-01-07T07:00:00Z', 'latestAt 取全组最新会话 startedAt');

  const untagged = progress.find((group) => group.caseId === '');
  assert.ok(untagged, 'null 与空白 caseId 归入同一未标注组');
  assert.equal(untagged.caseLabel, '病例未标注');
  assert.equal(untagged.indexNumber, null);
  assert.equal(untagged.trainCount, 2);
  assert.equal(untagged.completedCount, 1);
  assert.equal(untagged.reportCount, 1);
  assert.equal(untagged.latestScore, 95, 's5 无分不计，取 s4');
  assert.equal(untagged.latestAt, '2026-01-06T07:00:00Z', 's5 updatedAt 最新');

  const groupB = progress.find((group) => group.caseId === 'teacher-B');
  assert.ok(groupB);
  assert.equal(groupB.trainCount, 1);
  assert.equal(groupB.completedCount, 0);
  assert.equal(groupB.reportCount, 0);
  assert.equal(groupB.latestScore, null);

  assert.deepEqual(
    progress.map((group) => group.caseId),
    ['teacher-A', '', 'teacher-B'],
    '组按最近训练时间倒序',
  );
});

test('批次3·过程分不计入最近得分（沿用学情首页口径）', () => {
  const progress = buildCaseProgress([
    baseEntry({ sessionId: 'p1', caseId: 'teacher-P', totalScore: 99, scoreBasis: 'process', updatedAt: '2026-01-09T08:00:00Z' }),
    baseEntry({ sessionId: 'p2', caseId: 'teacher-P', totalScore: 82, scoreBasis: 'clinical', updatedAt: '2026-01-08T08:00:00Z' }),
  ], resolver);
  assert.equal(progress.length, 1);
  assert.equal(progress[0]?.latestScore, 82, '更新的过程分不抢最近得分');
  assert.equal(progress[0]?.latestScoreBasis, 'clinical');
});

test('批次3·空输入返回空数组', () => {
  assert.deepEqual(buildCaseProgress([], resolver), []);
});

test('批次3·teacherCaseMeta：目录命中/未收录回退/case-uuid 混入归一', () => {
  const first = TEACHER_CASE_CATALOG[0];
  assert.ok(first);
  const hit = teacherCaseMeta(first.id);
  assert.equal(hit.caseLabel, first.name, '目录命中 → 病名');
  assert.equal(typeof hit.indexNumber, 'number', '目录条目编号齐全');
  assert.equal(hit.indexNumber, CASE_INDEX_NUMBER[first.id] ?? null);

  const unknown = teacherCaseMeta('teacher-绝不存在的病种XYZ');
  assert.equal(unknown.caseLabel, 'teacher-绝不存在的病种XYZ', '目录未收录回退原始 id');
  assert.equal(unknown.indexNumber, null);

  const uuid = CASE_PUBLIC_IDS[first.id];
  assert.ok(uuid, '防透题映射覆盖');
  const viaUuid = teacherCaseMeta(uuid);
  assert.equal(viaUuid.caseLabel, first.name, 'case-uuid 输入经 resolveCaseId 归一后命中目录');
  assert.deepEqual(
    Object.keys(viaUuid).sort(),
    ['caseLabel', 'indexNumber'],
    '返回结构仅含目录元数据两个字段',
  );
});

type TestStore = { sessions: Map<string, ReturnType<typeof createInitialSession>> };

function memoryStore(): TestStore {
  const store = (globalThis as unknown as { __luojiaPedsStore?: TestStore }).__luojiaPedsStore;
  assert.ok(store, 'preview 内存存储应已初始化');
  return store;
}

const teacherActor = { id: 'preview-teacher-000', role: 'teacher' as const, displayName: '测试教师', studentNo: null, provider: 'preview' as const, chaoxingUid: null, accessToken: null };
const studentActor = { id: 'preview-student-001', role: 'student' as const, displayName: '张同学', studentNo: '20240001', provider: 'preview' as const, chaoxingUid: null, accessToken: null };

test('批次3·preview 档案聚合：病例分组+未标注组+权限门（集成）', async () => {
  const repo = new AgentRepository(teacherActor);
  // 第一次调用触发 preview 种子（种子会话 caseId 为旗舰病例，验证 uuid/teacher-id 归一进目录组）
  const seeded = await repo.getStudentProfile('preview-student-001');
  assert.equal(seeded.student.id, 'preview-student-001');
  assert.ok(seeded.sessions.length >= 1, '种子会话可见');
  for (const entry of seeded.sessions) {
    assert.ok('caseId' in entry && 'status' in entry, '档案条目含病例分组与状态字段');
  }
  const flagshipKey = TEACHER_CASE_CATALOG[0]?.id;
  assert.ok(flagshipKey, '教师目录非空');
  const flagship = seeded.caseProgress.find((group) => group.caseId === flagshipKey);
  assert.ok(flagship, '种子会话归入教师目录种子病例组');
  const catalogItem = TEACHER_CASE_CATALOG.find((item) => item.id === flagshipKey);
  assert.ok(catalogItem, '种子病例在教师目录内');
  assert.equal(flagship.caseLabel, catalogItem.name);
  assert.equal(flagship.trainCount >= 1, true);

  // 塞入一条无 caseId 的会话（数据完整性兜底：旧数据/异常数据归「病例未标注」组）
  const store = memoryStore();
  const untaggedSession = createInitialSession('preview-student-001', 'osce', flagshipKey);
  untaggedSession.id = 'test-untagged-session';
  untaggedSession.caseId = '';
  store.sessions.set(untaggedSession.id, untaggedSession);

  const profile = await repo.getStudentProfile('preview-student-001');
  const untagged = profile.caseProgress.find((group) => group.caseId === '');
  assert.ok(untagged, '无 caseId 会话归入未标注组');
  assert.equal(untagged.caseLabel, '病例未标注');
  assert.ok(untagged.trainCount >= 1);
  assert.ok(profile.sessions.some((session) => session.sessionId === 'test-untagged-session'));
  assert.ok(profile.sessions.every((session) => session.caseId !== undefined), 'caseId 归一为 null 而非 undefined');
});

test('批次3·preview 档案权限：学生 403 语义 + 未知学生 404 语义', async () => {
  const studentRepo = new AgentRepository(studentActor);
  await assert.rejects(() => studentRepo.getStudentProfile('preview-student-001'), /FORBIDDEN/, '学生角色不可查他人档案');
  const teacherRepo = new AgentRepository(teacherActor);
  await assert.rejects(() => teacherRepo.getStudentProfile('preview-无此学生'), /STUDENT_NOT_FOUND/, '不可见或不存在同口径 404');
});
