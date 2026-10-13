import assert from 'node:assert/strict';
import test from 'node:test';
import { postureAllows, sourceExamDefinitions } from '../src/domain/exam-methods';

test('腹部视触叩听与反射分别取对应原文片段，不传播完整查体答案', () => {
  const records = sourceExamDefinitions('腹稍胀，无压痛，移动浊音（+），肠鸣音正常，双下肢水肿，膝反射存在。');
  const result = (method: string, part: string) => records.find(row => row[0] === method && row[1] === part)?.[3] ?? '';
  assert.equal(result('inspection', 'abdomen'), '腹稍胀');
  assert.equal(result('palpation', 'abdomen'), '无压痛');
  assert.equal(result('percussion', 'abdomen'), '移动浊音（+）');
  assert.equal(result('stethoscope', 'abdomen'), '肠鸣音正常');
  assert.equal(result('reflex-hammer', 'limbs'), '膝反射存在');
  assert.ok(!result('palpation', 'abdomen').includes('肠鸣音'));
});
test('没有记录不补正常值；腹部新请求需仰卧，历史请求保留兼容', () => {
  assert.ok(sourceExamDefinitions('').every(row => !row[3]));
  assert.equal(postureAllows('abdomen', 'standing'), false);
  assert.equal(postureAllows('abdomen', 'supine'), true);
  assert.equal(postureAllows('abdomen'), true);
  assert.equal(postureAllows('chest', 'standing'), true);
});
