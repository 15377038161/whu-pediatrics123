import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSnapshotSections } from '@/lib/case-snapshot';

test('召回分段：诊疗经过内入院完善相关检查不夺走处置正文', () => {
  const result = splitSnapshotSections('主诉：合成病例\n辅助检查：初诊结果甲\n诊疗经过\n入院后完善相关检查：复查结果乙\n后续教学处置');
  assert.ok(result.tests.includes('初诊结果甲'));
  assert.ok(!result.tests.includes('复查结果乙'));
  assert.ok(result.plan.includes('复查结果乙'));
  assert.ok(result.plan.includes('后续教学处置'));
});

test('召回分段：明确新检查章节及方括号标题仍可切换', () => {
  const colon = splitSnapshotSections('治疗方案：合成方案\n三、辅助检查：明确新章节');
  assert.ok(colon.tests.includes('明确新章节'));
  assert.ok(!colon.plan.includes('明确新章节'));
  const bracket = splitSnapshotSections('诊疗经过：合成方案\n【辅助检查】合成检查内容');
  assert.ok(bracket.tests.includes('合成检查内容'));
});

test('召回分段：编号诊断不会命中find中第一个查体规则', () => {
  const result = splitSnapshotSections('主诉：合成病例\n二、诊断 合成诊断\n三、查体：合成体征');
  assert.ok(result.diagnosis.includes('合成诊断'));
  assert.ok(!result.exam.includes('合成诊断'));
  assert.ok(result.exam.includes('合成体征'));
});

test('召回分段：入院检查初始段仍可识别，媒体噪声不混入处置', () => {
  const result = splitSnapshotSections('主诉：合成病例\n入院后完善相关检查：合成初诊结果\n诊疗经过：合成处置\n![示例](https://example.invalid/image.png)');
  assert.ok(result.tests.includes('合成初诊结果'));
  assert.ok(result.plan.includes('合成处置'));
  assert.ok(!result.plan.includes('example.invalid'));
});
