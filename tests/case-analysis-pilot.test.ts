import assert from 'node:assert/strict';
import test from 'node:test';
import { groundCaseAnswerKey } from '../src/domain/case-analysis';
import type { PointJudgementMap } from '../src/domain/diagnosis-answer';
import { generateCaseAnswerKey, gradeCaseAnalysis } from '../src/lib/case-analysis-ai';
import {
  dkaFullJudgements,
  dkaFullSubmission,
  dkaGeneratedKey,
  dkaOnlyPrimaryJudgements,
  dkaOnlyPrimarySubmission,
  dkaPartialJudgements,
  dkaPartialSubmission,
  dkaSource,
  dkaWrongJudgements,
  dkaWrongSubmission,
} from './fixtures/dka-case-analysis';

function groundedKey() {
  const grounded = groundCaseAnswerKey(dkaGeneratedKey, dkaSource);
  assert.ok('key' in grounded);
  return grounded.key;
}

test('DKA 试点：生成标答保留 6 条依据、6 条处理，原件无鉴别诊断则不计该段', async () => {
  const record = await generateCaseAnswerKey('teacher-1型糖尿病伴有酮症酸中毒', {
    deps: {
      readCase: () => ({
        caseId: 'teacher-1型糖尿病伴有酮症酸中毒',
        version: 'a'.repeat(16),
        sourceName: '1型糖尿病伴有酮症酸中毒',
        age: '6岁',
        sex: '女',
        complaint: '多饮多尿1周，呕吐伴乏力精神差2天',
        sections: dkaSource,
      }),
      generate: async () => JSON.stringify(dkaGeneratedKey),
    },
  });
  assert.equal(record.status, 'auto');
  assert.ok(record.key);
  assert.equal(record.key.evidence.length, 6);
  assert.equal(record.key.management.length, 6);
  assert.equal(record.key.differentials, undefined);
});

test('DKA 试点：全对答案拿到 100/100，且无漏项', async () => {
  const key = groundedKey();
  const result = await gradeCaseAnalysis(key, dkaFullSubmission, {
    judgements: dkaFullJudgements as PointJudgementMap,
    deps: { generate: async () => { throw new Error('不应调用模型'); } },
  });
  assert.equal(result.usedFallback, false);
  assert.equal(result.grade.maxScore, 100);
  assert.equal(result.grade.totalScore, 100);
  assert.deepEqual(result.grade.missingPoints, []);
  assert.equal(result.grade.points.filter((point) => point.status === 'covered').length, 14);
});

test('DKA 试点：部分答案按命中点数计分，不因为写了字给满段分', async () => {
  const key = groundedKey();
  const result = await gradeCaseAnalysis(key, dkaPartialSubmission, {
    judgements: dkaPartialJudgements as PointJudgementMap,
    deps: { generate: async () => { throw new Error('不应调用模型'); } },
  });
  assert.equal(result.usedFallback, false);
  assert.equal(result.grade.diagnosis.primaryScore, 30);
  assert.equal(result.grade.diagnosis.secondaryScore, 0);
  assert.equal(result.grade.evidence.score, 8);
  assert.equal(result.grade.management.score, 8);
  assert.equal(result.grade.totalScore, 46);
  assert.ok(result.grade.missingPoints.length > 0);
});

test('DKA 试点：错误诊断和错误处理得 0 分', async () => {
  const key = groundedKey();
  const result = await gradeCaseAnalysis(key, dkaWrongSubmission, {
    judgements: dkaWrongJudgements as PointJudgementMap,
    deps: { generate: async () => { throw new Error('不应调用模型'); } },
  });
  assert.equal(result.grade.totalScore, 0);
  assert.equal(result.grade.maxScore, 100);
  assert.equal(result.grade.diagnosis.primaryHit, false);
});

test('DKA 试点：只写对第一诊断只拿 30 分，不会被白送依据/处理分', async () => {
  const key = groundedKey();
  const result = await gradeCaseAnalysis(key, dkaOnlyPrimarySubmission, {
    judgements: dkaOnlyPrimaryJudgements as PointJudgementMap,
    deps: { generate: async () => { throw new Error('不应调用模型'); } },
  });
  assert.equal(result.grade.diagnosis.primaryScore, 30);
  assert.equal(result.grade.diagnosis.secondaryScore, 0);
  assert.equal(result.grade.evidence.score, 0);
  assert.equal(result.grade.management.score, 0);
  assert.equal(result.grade.totalScore, 30);
  assert.equal(result.grade.maxScore, 100);
});