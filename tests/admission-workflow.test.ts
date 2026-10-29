import './fixtures/legacy-engine-catalog';
import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAdmission, verifiedComplaint } from '../src/lib/case-admission';
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

test('接诊不补造主诉、不泄漏病种，不接受缺省占位', () => {
  const source = (complaint: string) => ({ complaint } as TeacherCaseData);
  assert.equal(verifiedComplaint(null), null);
  assert.equal(verifiedComplaint(source('待核验')), null);
  assert.equal(verifiedComplaint(source('主诉：发热3天')), '发热3天');
  assert.equal(verifiedComplaint(source('川崎病治疗后复诊')), null);
});

test('创建请求：互斥参数、请求身份隔离、重试返回同一会话', async () => {
  assert.equal(createSessionSchema.safeParse({ mode: 'guided', random: true }).success, false);
  assert.equal(createSessionSchema.safeParse({ mode: 'osce', random: true, clientRequestId: crypto.randomUUID() }).success, false);
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
