import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DiagnosisExtractionError,
  clearExtractionCache,
  extractCaseAnswer,
} from '@/lib/diagnosis-answer-extract';
import { type TeacherCaseData } from '@/lib/teacher-case-data';
import {computeCaseDataVersion} from '@/lib/case-data-version';

const FIXTURE_CASE_ID = 'teacher-合成抽取测试';

function fakeCase(diagnosis: string, plan: string): TeacherCaseData {
  return {
    caseId: FIXTURE_CASE_ID,
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

// 可公开的合成原件；不依赖私有病例目录，也不消耗真实模型额度。
const fixture = fakeCase([
  '【初步诊断】', '入院诊断', '合成入院诊断甲', '出院诊断',
  '合成出院诊断乙', '合成出院诊断丙', '合成保留行一', '合成保留行二', '合成出院诊断丁',
].join('\n'), '合成处理步骤甲');

function respond(diagnoses: string[], management: string[] = []): string {
  return JSON.stringify({ diagnoses, management });
}

test('合成原件经注入模型抽取，产出带行号与入院/出院归属的可核对条目', async () => {
  clearExtractionCache();
  const record = fixture;
  assert.ok(record, '合成原件已注入');
  let promptSeen = '';
  const result = await extractCaseAnswer(FIXTURE_CASE_ID, {
    deps: {
      readCase: () => fixture,
      generate: async (messages) => {
        promptSeen = String(messages[0]?.content ?? '');
        return respond(['合成入院诊断甲', '合成出院诊断乙', '合成出院诊断丁'], ['合成处理步骤甲']);
      },
    },
  });
  assert.equal(result.caseId, record.caseId);
  assert.match(result.version, /^[a-f0-9]{16}$/);
  assert.equal(result.cached, false);
  // 合成原件保留标题与分期的物理行号，不把格式化行号当作真实病例验收。
  assert.deepEqual(result.diagnoses.map((item) => [item.sourceQuote, item.sourceLine, item.phase]), [
    ['合成入院诊断甲', 3, 'admission'],
    ['合成出院诊断乙', 5, 'discharge'],
    ['合成出院诊断丁', 9, 'discharge'],
  ]);
  assert.deepEqual(result.management.map((item) => item.sourceQuote), ['合成处理步骤甲']);
  assert.equal(result.dropped.length, 0);
  // 提示词必须带上原件两段与题目信息，否则模型无从逐字摘取
  assert.ok(promptSeen.includes(record.sections.diagnosis));
  assert.ok(promptSeen.includes(record.sections.plan));
  assert.ok(promptSeen.includes(`年龄：${record.age}`));
});

test('同一病例内容指纹命中缓存，不重复消耗模型配额', async () => {
  clearExtractionCache();
  let calls = 0;
  const counting = { readCase: () => fixture, generate: async () => { calls += 1; return respond(['合成出院诊断丁']); } };
  const first = await extractCaseAnswer(FIXTURE_CASE_ID, { deps: counting });
  const second = await extractCaseAnswer(FIXTURE_CASE_ID, { deps: counting });
  assert.equal(calls, 1, '第二次不再调用模型');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.diagnoses, first.diagnoses);
});

test('模型编造的诊断被服务端挡下并如实回报，不会变成标答', async () => {
  clearExtractionCache();
  const result = await extractCaseAnswer(FIXTURE_CASE_ID, {
    deps: { readCase: () => fixture, generate: async () => respond(['合成出院诊断丙', '合成未记录诊断一', '合成未记录诊断二']) },
  });
  assert.deepEqual(result.diagnoses.map((item) => item.sourceQuote), ['合成出院诊断丙']);
  assert.deepEqual(result.dropped.map((item) => item.sourceQuote), ['合成未记录诊断一', '合成未记录诊断二']);
  assert.match(result.dropped[0].reason, /不是原件的逐字内容/);
});

test('模型输出不合法 / 调用失败 / 全部被丢弃，都明确报错而不是返回半成品', async () => {
  clearExtractionCache();
  const cases: Array<[() => Promise<string>, string]> = [
    [async () => '本例诊断为合成入院诊断甲', 'MODEL_RESPONSE_INVALID'],
    [async () => { throw new Error('gateway 503'); }, 'MODEL_UNAVAILABLE'],
    [async () => respond(['合成未记录诊断一']), 'EXTRACTION_EMPTY'],
  ];
  for (const [generate, expected] of cases) {
    clearExtractionCache();
    await assert.rejects(
      () => extractCaseAnswer(FIXTURE_CASE_ID, { deps: { readCase: () => fixture, generate } }),
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
  const record = fixture;
  assert.ok(record);
  const current = await extractCaseAnswer(FIXTURE_CASE_ID, { deps: { readCase: () => fixture, generate: async () => respond(['合成出院诊断丁']) } });
  const older = fakeCase('入院诊断：合成入院诊断甲', '给予抗感染治疗');
  const olderVersion=computeCaseDataVersion(older);
  const injected = await extractCaseAnswer(FIXTURE_CASE_ID, {
    version:olderVersion,
    deps: { readCase: (id,version) => {assert.equal(id,FIXTURE_CASE_ID);assert.equal(version,olderVersion);return older;}, generate: async () => respond(['合成入院诊断甲'], ['抗感染']) },
  });
  assert.notEqual(injected.version, current.version, '内容不同则指纹不同');
  assert.deepEqual(injected.diagnoses, [{ sourceQuote: '合成入院诊断甲', sourceLine: 1, phase: 'admission' }]);
  clearExtractionCache();
});
