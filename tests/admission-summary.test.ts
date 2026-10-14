import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_CATALOG } from '../src/domain/case-catalog';
import { admissionProfile } from '../src/lib/case-admission';
import summaries from '../src/domain/admission-summaries.json';
import { TEACHER_CASE_CATALOG } from '../src/domain/teacher-case-catalog';

test('部署缺少私有资料时仍显示年龄、性别、真实主诉', () => {
  const previous = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  process.env.PEDIATRICS_KNOWLEDGE_ROOT = 'outputs/nonexistent-admission-test';
  try {
    assert.equal(Object.keys(summaries).length, 67);
    for (const id of Object.keys(summaries)) {
      const profile = CASE_CATALOG.find(item => item.id === id)!;
      const actual = admissionProfile(profile);
      assert.equal(actual.title, profile.title);
      assert.ok(actual.title.includes(actual.age));
      assert.ok(actual.title.includes(actual.presentingSymptoms[0]));
      assert.ok(!actual.title.includes('待补充'));
    }
    for (const summary of Object.values(summaries)) {
      assert.deepEqual(Object.keys(summary).sort(), ['age', 'complaint', 'sex']);
      assert.ok(!/姓名|住院号|诊断/.test(summary.complaint));
      assert.ok(!TEACHER_CASE_CATALOG.some(item => summary.complaint.includes(item.name)), '摘要不得直接给出目录诊断');
    }
  } finally {
    if (previous === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;
    else process.env.PEDIATRICS_KNOWLEDGE_ROOT = previous;
  }
});
