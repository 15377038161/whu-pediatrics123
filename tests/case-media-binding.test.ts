import './fixtures/legacy-engine-catalog';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { FLAGSHIP_CASE } from '@/domain/case';
import { sourceExamDefinitions } from '@/domain/exam-methods';
import { findReleasedMedia } from '@/lib/case-media';

process.env.ENABLE_AI_FIXTURE = 'true';

/** 媒体按检查/操作触发绑定（补充单）：
 *  - CaseMedia 绑定在 AuxiliaryTest/ExamRule 上（教师病例 JSON 经 testMedia/examMedia 元数据声明）；
 *  - 结果实际释放时媒体随事件挂载（handleTest/handleExam 成功路径）；
 *  - 分时点门控未到回报时点：只记单待回报，事件不挂载媒体（不提前泄露媒体存在）；
 *  - 未绑定媒体的项事件无 media 字段（向后兼容既有病例行为）；
 *  - findReleasedMedia 仅认本会话已释放媒体（fail-closed，防遍历探测病例配置中的未释放媒体）。 */

test('检查结果释放：绑定媒体随事件挂载；未绑定项事件无 media 字段（向后兼容）', async (t) => {
  const cbc = FLAGSHIP_CASE.tests.find((item) => item.id === 'cbc-crp')!;
  cbc.media = [{ fileId: 'file-cbc-report-1', kind: 'image', caption: '血常规与CRP报告' }];
  t.after(() => { delete cbc.media; });

  const session = createInitialSession('student-media-test', 'guided');
  const withMedia = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'cbc-crp' } }, 'media-test-cbc');
  const mediaEvent = withMedia.session.events.find((item) => item.clientEventId === 'media-test-cbc')!;
  assert.deepEqual(mediaEvent.media, [{ fileId: 'file-cbc-report-1', kind: 'image', caption: '血常规与CRP报告' }], '释放事件应挂载该检查绑定的媒体');

  const plain = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'chest-image' } }, 'media-test-chest');
  const plainEvent = plain.session.events.find((item) => item.clientEventId === 'media-test-chest')!;
  assert.equal(plainEvent.media, undefined, '未绑定媒体的检查事件不应有 media 字段');
});

test('查体结果释放：绑定媒体随事件挂载', async (t) => {
  const respiratory = FLAGSHIP_CASE.exams.find((item) => item.id === 'respiratory')!;
  respiratory.media = [{ fileId: 'file-lung-photo-1', kind: 'image', caption: '肺部听诊示教图' }];
  t.after(() => { delete respiratory.media; });

  const session = createInitialSession('student-media-exam', 'guided');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'media-exam-prep');
  const result = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'media-exam-chest');
  const event = result.session.events.find((item) => item.clientEventId === 'media-exam-chest')!;
  assert.equal(event.correct, true, '查体应成功释放');
  assert.deepEqual(event.media, [{ fileId: 'file-lung-photo-1', kind: 'image', caption: '肺部听诊示教图' }], '查体释放事件应挂载绑定媒体');
});

test('分时点门控：未到回报时点不挂载媒体；到达后释放时挂载并可解析', async (t) => {
  const cbc = FLAGSHIP_CASE.tests.find((item) => item.id === 'cbc-crp')!;
  cbc.availableFromStage = 'assessment';
  cbc.resultDelayNote = '标本送检，约 2 小时后回报。';
  cbc.media = [{ fileId: 'file-cbc-report-1', kind: 'image', caption: '血常规与CRP报告' }];
  t.after(() => { delete cbc.availableFromStage; delete cbc.resultDelayNote; delete cbc.media; });

  const session = createInitialSession('student-media-gated', 'guided');
  const pending = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'cbc-crp' } }, 'media-gated-pending');
  const pendingEvent = pending.session.events.find((item) => item.clientEventId === 'media-gated-pending')!;
  assert.equal(pendingEvent.media, undefined, '待回报事件不得挂载媒体（不提前泄露媒体存在）');
  assert.equal(findReleasedMedia(pending.session, 'file-cbc-report-1'), null, '未释放媒体不可解析');

  await runAgentTurn(session, {
    type: 'SUBMIT_DECISION',
    data: { diagnosis: '支气管肺炎', summary: '发热咳嗽 3 天，右下肺湿啰音。', diagnosisBasis: '发热咳嗽伴右下肺湿啰音，结合胸片浸润影', differentials: '需与喘息性支气管炎鉴别' },
  }, 'media-gated-decision');
  const released = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'cbc-crp' } }, 'media-gated-released');
  const releasedEvent = released.session.events.find((item) => item.clientEventId === 'media-gated-released')!;
  assert.deepEqual(releasedEvent.media, [{ fileId: 'file-cbc-report-1', kind: 'image', caption: '血常规与CRP报告' }], '到达回报阶段后释放应挂载媒体');
  assert.ok(findReleasedMedia(released.session, 'file-cbc-report-1'), '已释放媒体可解析');
  assert.equal(findReleasedMedia(released.session, 'file-not-exists'), null, '未登记的 fileId 一律不可解析');
});

test('教师病例 testMedia/examMedia 元数据：schema 解析 → createSourceCase 应用 → 释放挂载（全链路）', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pediatrics-media-src-'));
  const oldRoot = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  process.env.PEDIATRICS_KNOWLEDGE_ROOT = temp;
  t.after(async () => {
    if (oldRoot === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT; else process.env.PEDIATRICS_KNOWLEDGE_ROOT = oldRoot;
    await rm(temp, { recursive: true, force: true });
  });
  const id = 'teacher-肾病综合征';
  const examText = 'T36.5℃，双肺呼吸音清，腹稍胀，移动浊音（+）。';
  const definitions = sourceExamDefinitions(examText);
  assert.ok(definitions.length > 0, '夹具查体文本应解析出至少一项查体定义');
  const [toolId, bodyPartId] = definitions[0];
  const examId = `source-exam-${toolId}-${bodyPartId}`;
  await mkdir(path.join(temp, 'teaching-cases'));
  // 合成夹具（非真实病例）：验证媒体绑定元数据链路，不代表真实教学病例内容；fileId 为虚构标识。
  await writeFile(path.join(temp, 'teaching-cases', `${id}.json`), JSON.stringify({
    caseId: id, sourceName: '肾病综合征', sourceDocument: '合成夹具', age: '12岁', sex: '男', complaint: '水肿2周',
    sections: { history: '1.患儿，男，12岁；2.发现水肿2周。双下肢水肿。无血尿。', exam: examText, tests: '尿常规：尿蛋白+++', diagnosis: '肾病综合征', plan: '合成夹具，不作为真实医疗建议。' },
    vitals: { temperature: 36.5, heartRate: null, respiratoryRate: null, spo2: null }, documents: [],
    testMedia: [{ testId: 'source-test-0', media: [{ fileId: 'file-urine-report-1', kind: 'image', caption: '尿常规报告' }] }],
    examMedia: [{ examId, media: [{ fileId: 'file-exam-photo-1', kind: 'image', caption: '腹部查体示教图' }] }],
  }));

  const session = createInitialSession('student-media-src', 'guided', id);
  const ordered = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'source-test-0' } }, 'media-src-test');
  const testEvent = ordered.session.events.find((item) => item.clientEventId === 'media-src-test')!;
  assert.deepEqual(testEvent.media, [{ fileId: 'file-urine-report-1', kind: 'image', caption: '尿常规报告' }], '教师病例检查媒体应随释放挂载');

  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'media-src-prep');
  const examined = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId, bodyPartId } }, 'media-src-exam');
  const examEvent = examined.session.events.find((item) => item.clientEventId === 'media-src-exam')!;
  assert.equal(examEvent.correct, true, '夹具查体应成功释放');
  assert.deepEqual(examEvent.media, [{ fileId: 'file-exam-photo-1', kind: 'image', caption: '腹部查体示教图' }], '教师病例查体媒体应随释放挂载');
});
