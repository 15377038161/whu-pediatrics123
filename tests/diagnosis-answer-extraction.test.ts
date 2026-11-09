import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DiagnosisExtractionError,
  clearExtractionCache,
  extractCaseAnswer,
} from '@/lib/diagnosis-answer-extract';
import { readTeacherCaseData, type TeacherCaseData } from '@/lib/teacher-case-data';

const REAL_CASE_ID = 'teacher-化脓性脑膜炎';

function fakeCase(diagnosis: string, plan: string): TeacherCaseData {
  return {
    caseId: 'teacher-测试病例',
    sourceName: '测试病例',
    sourceDocument: '测试原件',
    age: '6岁',
    sex: '女',
    complaint: '发热伴乏力半天',
    sections: { history: '', exam: '', tests: '', diagnosis, plan },
    vitals: { temperature: null, heartRate: null, respiratoryRate: null, spo2: null },
    documents: [],
  };
}

function respond(diagnoses: string[], management: string[] = []): string {
  return JSON.stringify({ diagnoses, management });
}

test('真实病例原件经注入模型抽取，产出带行号与入院/出院归属的可核对条目', async () => {
  clearExtractionCache();
  const record = readTeacherCaseData(REAL_CASE_ID);
  assert.ok(record, '本地受控原件可读');
  let promptSeen = '';
  const result = await extractCaseAnswer(REAL_CASE_ID, {
    deps: {
      generate: async (messages) => {
        promptSeen = String(messages[0]?.content ?? '');
        return respond(['支气管肺炎', '大肠埃希杆菌脑膜炎', '轻度贫血'], ['抗感染（舒普深、美罗培南）']);
      },
    },
  });
  assert.equal(result.caseId, record.caseId);
  assert.match(result.version, /^[a-f0-9]{16}$/);
  assert.equal(result.cached, false);
  // 9cfa 规范化快照将【初步诊断】与“入院诊断”独立为前两行，以下为原件物理行号。
  assert.deepEqual(result.diagnoses.map((item) => [item.sourceQuote, item.sourceLine, item.phase]), [
    ['支气管肺炎', 3, 'admission'],
    ['大肠埃希杆菌脑膜炎', 5, 'discharge'],
    ['轻度贫血', 9, 'discharge'],
  ]);
  assert.deepEqual(result.management.map((item) => item.sourceQuote), ['抗感染（舒普深、美罗培南）']);
  assert.equal(result.dropped.length, 0);
  // 提示词必须带上原件两段与题目信息，否则模型无从逐字摘取
  assert.ok(promptSeen.includes(record.sections.diagnosis));
  assert.ok(promptSeen.includes(record.sections.plan));
  assert.ok(promptSeen.includes(`年龄：${record.age}`));
});

test('同一病例内容指纹命中缓存，不重复消耗模型配额', async () => {
  clearExtractionCache();
  let calls = 0;
  const counting = { generate: async () => { calls += 1; return respond(['轻度贫血']); } };
  const first = await extractCaseAnswer(REAL_CASE_ID, { deps: counting });
  const second = await extractCaseAnswer(REAL_CASE_ID, { deps: counting });
  assert.equal(calls, 1, '第二次不再调用模型');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.diagnoses, first.diagnoses);
});

test('模型编造的诊断被服务端挡下并如实回报，不会变成标答', async () => {
  clearExtractionCache();
  const result = await extractCaseAnswer(REAL_CASE_ID, {
    deps: { generate: async () => respond(['革兰阴性杆菌败血症', '病毒性脑炎', '川崎病']) },
  });
  assert.deepEqual(result.diagnoses.map((item) => item.sourceQuote), ['革兰阴性杆菌败血症']);
  assert.deepEqual(result.dropped.map((item) => item.sourceQuote), ['病毒性脑炎', '川崎病']);
  assert.match(result.dropped[0].reason, /不是原件的逐字内容/);
});

test('模型输出不合法 / 调用失败 / 全部被丢弃，都明确报错而不是返回半成品', async () => {
  clearExtractionCache();
  const cases: Array<[() => Promise<string>, string]> = [
    [async () => '本例诊断为支气管肺炎', 'MODEL_RESPONSE_INVALID'],
    [async () => { throw new Error('gateway 503'); }, 'MODEL_UNAVAILABLE'],
    [async () => respond(['病毒性脑炎']), 'EXTRACTION_EMPTY'],
  ];
  for (const [generate, expected] of cases) {
    clearExtractionCache();
    await assert.rejects(
      () => extractCaseAnswer(REAL_CASE_ID, { deps: { generate } }),
      (error: unknown) => error instanceof DiagnosisExtractionError && error.code === expected,
    );
  }
});

test('原件缺失或诊断/计划全空时不调用模型', async () => {
  clearExtractionCache();
  await assert.rejects(
    () => extractCaseAnswer('no-such-case'),
    (error: unknown) => error instanceof DiagnosisExtractionError && error.code === 'CASE_NOT_FOUND',
  );
  let called = false;
  await assert.rejects(
    () => extractCaseAnswer('teacher-测试病例', {
      deps: {
        readCase: () => fakeCase('', '   '),
        generate: async () => { called = true; return respond(['x']); },
      },
    }),
    (error: unknown) => error instanceof DiagnosisExtractionError && error.code === 'SOURCE_ANSWER_EMPTY',
  );
  assert.equal(called, false, '没有原件内容就不该消耗配额');
});

test('绑定历史版本时按该版本原件抽取，缓存键随内容指纹变化', async () => {
  clearExtractionCache();
  const record = readTeacherCaseData(REAL_CASE_ID);
  assert.ok(record);
  const current = await extractCaseAnswer(REAL_CASE_ID, { deps: { generate: async () => respond(['轻度贫血']) } });
  const older = fakeCase('入院诊断：支气管肺炎', '给予抗感染治疗');
  const injected = await extractCaseAnswer('teacher-测试病例', {
    deps: { readCase: () => older, generate: async () => respond(['支气管肺炎'], ['抗感染']) },
  });
  assert.notEqual(injected.version, current.version, '内容不同则指纹不同');
  assert.deepEqual(injected.diagnoses, [{ sourceQuote: '支气管肺炎', sourceLine: 1, phase: 'admission' }]);
  clearExtractionCache();
});
