import './fixtures/legacy-engine-catalog';
import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleAdmissions, hasResolvableCaseSource, scorableAdmissions, selectAdmission, verifiedComplaint } from '../src/lib/case-admission';
import { creationSessionId } from '../src/lib/session-creation';
import { AgentRepository } from '../src/lib/repository';
import { createSessionSchema } from '../src/lib/validation';
import { buildReport } from '../src/lib/scoring';
import { createInitialSession } from '../src/lib/agent-engine';
import type { TeacherCaseData } from '../src/lib/teacher-case-data';
import { CASE_CATALOG } from '../src/domain/case-catalog';
import { publicCaseId, resolveCaseId } from '../src/lib/case-identity';
import { projectSessionForRole } from '../src/lib/session-projection';

test('随机资格选择：零例、一例、当前病例、同源别名、多例', () => {
  assert.throws(() => selectAdmission([]), /NO_ELIGIBLE_CASE/);
  const pool = [{ caseId: 'teacher-肺炎支原体肺炎', sourceId: 'teacher-肺炎支原体肺炎' }];
  assert.throws(() => selectAdmission(pool, 'teacher-大叶性肺炎'), /ONLY_CURRENT_CASE/);
  assert.equal(selectAdmission(pool, 'teacher-大叶性肺炎', true), pool[0].caseId);
  assert.equal(selectAdmission([...pool, { caseId: 'other', sourceId: 'other' }], pool[0].caseId), 'other');
});

test('专项/OSCE 随机池：可评分守卫前移，取不到的病例不进池，真实目录一例都不能被误滤', () => {
  const pool = eligibleAdmissions(new Set());
  assert.ok(pool.length > 0, '部署环境 localFiles=missing 时目录级资格池仍不能为空');
  const kept = scorableAdmissions([...pool, { caseId: 'no-such-case', sourceId: 'no-such-case' }]);
  assert.equal(kept.length, pool.length, '真实目录病例被误滤会缩小随机池，最坏直接 NO_ELIGIBLE_CASE');
  for (const candidate of pool) assert.ok(kept.includes(candidate), `${candidate.caseId} 被误滤`);
  assert.ok(!kept.some((candidate) => candidate.caseId === 'no-such-case'), '取不到的病例进了随机池，学生抽中即 CASE_NOT_FOUND');
  assert.deepEqual(scorableAdmissions([]), []);
  assert.throws(() => selectAdmission(scorableAdmissions([])), /NO_ELIGIBLE_CASE/);
});

test('资格池不依赖本地病例事实；可玩性探测按本地/缓存/DB 判断，缺件病例不会被假装可玩', async () => {
  const synthetic = {
    id: 'case-catalog-only-without-source' as const,
    version: 1,
    title: '目录可评分但事实缺失',
    subtitle: '测试夹具',
    category: '测试',
    presentingSymptoms: [],
    age: '待核验',
    sex: '待核验' as const,
    difficulty: '真实案例学习',
    expectedMinutes: 0,
    patientName: '小朋友',
    patientImage: '',
    patientAlt: '',
    contentStatus: 'teacher-materials-indexed' as const,
    sourceRelation: null,
    mediaCount: 0,
    documentCount: 0,
  };
  CASE_CATALOG.push(synthetic);
  try {
    const pool = eligibleAdmissions(new Set());
    assert.ok(pool.some((candidate) => candidate.caseId === synthetic.id), '目录里可评分但本地无事实的病例被同步过滤，部署环境会整池为空');
    assert.equal(await hasResolvableCaseSource({ caseId: synthetic.id, sourceId: synthetic.id }, null), false, '缺件病例不应被探测为可玩');
  } finally {
    CASE_CATALOG.pop();
  }
});

test('OSCE 随机开例走通：抽到病例、按随机站 15:00 计时、站点写进会话供门控复用', async () => {
  const repo = new AgentRepository({ id: 'preview-osce-random', role: 'student', displayName: '合成验收学生', studentNo: null, provider: 'preview', chaoxingUid: null, accessToken: null });
  const pool = eligibleAdmissions(new Set());
  if (pool.length === 0) return;
  const session = await repo.createRequestedSession({ mode: 'osce', random: true, clientRequestId: crypto.randomUUID() });
  assert.equal(session.mode, 'osce');
  assert.ok(session.caseId.trim().length > 0, 'osce 随机没抽到病例，入口点进去就是空会话');
  assert.ok(pool.some((candidate) => candidate.caseId === session.caseId), `${session.caseId} 不在资格池里，说明抽例绕过了守卫`);
  assert.equal(session.osceStation?.stationId, 'osce-station-random');
  assert.equal(session.osceStation?.timeLimitSeconds, 900);
  assert.ok(session.expiresAt, '没有截止时间，服务端就无法在时间到后拒绝新增临床操作');
  const remaining = Date.parse(session.expiresAt) - Date.now();
  assert.ok(remaining > 890_000 && remaining <= 900_000, `倒计时不是 15:00：${remaining}ms`);
});

test('接诊不补造主诉、不泄漏病种，不接受缺省占位', () => {
  const source = (complaint: string) => ({ complaint } as TeacherCaseData);
  assert.equal(verifiedComplaint(null), null);
  assert.equal(verifiedComplaint(source('待核验')), null);
  assert.equal(verifiedComplaint(source('主诉：发热3天')), '发热3天');
  assert.equal(verifiedComplaint(source('川崎病治疗后复诊')), null);
});

test('创建请求：互斥参数、请求身份隔离、重试返回同一会话', async () => {
  assert.equal(createSessionSchema.safeParse({ mode: 'guided', random: true }).success, false);
  // 四种模式都可服务端随机抽例（专项/OSCE 入口不再自带 caseId），但仍需请求标识、仍不得同时指定病例。
  for (const mode of ['guided', 'practice', 'osce', 'immersive'] as const) {
    assert.equal(createSessionSchema.safeParse({ mode, random: true, clientRequestId: crypto.randomUUID() }).success, true, mode);
    assert.equal(createSessionSchema.safeParse({ mode, random: true }).success, false, mode);
    assert.equal(createSessionSchema.safeParse({ mode, random: true, caseId: 'case-1', clientRequestId: crypto.randomUUID() }).success, false, mode);
    assert.equal(createSessionSchema.safeParse({ mode, allowRepeat: true, clientRequestId: crypto.randomUUID() }).success, false, mode);
  }
  assert.notEqual(creationSessionId('one', 'req'), creationSessionId('two', 'req'));
  const repo = new AgentRepository({ id: 'preview-admission-test', role: 'student', displayName: '合成验收学生', studentNo: null, provider: 'preview', chaoxingUid: null, accessToken: null });
  const options = { mode: 'guided' as const, caseId: 'peds-respiratory-001', clientRequestId: crypto.randomUUID() };
  const [first, second] = await Promise.all([repo.createRequestedSession(options), repo.createRequestedSession(options)]);
  assert.equal(first.id, second.id);
  const retry = await repo.createRequestedSession(options);
  assert.equal(retry.id, first.id);
  await assert.rejects(repo.createRequestedSession({ ...options, mode: 'practice' }), /CREATION_REQUEST_CONFLICT/);
});

test('报告固定最终学生依据，修订不重写已生成报告', () => {
  const session = createInitialSession('test', 'guided');
  session.decision = { diagnosis: '学生判断', summary: '依据本次问查进行判断', diagnosisBasis: '本次已采集的病史与体征依据', differentials: '' };
  const report = buildReport(session);
  session.decision.diagnosisBasis = '后续修订';
  assert.equal(report.studentDecision?.diagnosisBasis, '本次已采集的病史与体征依据');
});

test('客户端目录和active学生响应不通过病例ID泄漏病种，历史ID仍可解析', () => {
  assert.equal(CASE_CATALOG.filter(item => item.id.startsWith('case-')).length, 67);
  const publicId = publicCaseId('teacher-川崎病');
  assert.equal(resolveCaseId(publicId), 'teacher-川崎病');
  assert.equal(publicId.includes('川崎'), false);
  const session = createInitialSession('test', 'guided', publicId);
  session.creationRequest = JSON.stringify(['guided', 'teacher-川崎病']);
  assert.equal(session.caseId, 'teacher-川崎病');
  const projected = projectSessionForRole(session, 'student');
  assert.equal(projected.caseId, publicId);
  assert.equal(projected.creationRequest, undefined);
  assert.ok(!JSON.stringify(projected).includes('teacher-川崎病'));
});
