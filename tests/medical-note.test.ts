import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTE_SECTION_KEYS, NOTE_TEMPLATE, NOTE_TEMPLATE_VERSION, normalizeNoteContent, noteContentSchema, sectionCompleteness } from '../src/domain/medical-note';

/** 批次6·病历模板/内容归一/完整性判定纯函数。 */

test('normalizeNoteContent：仅保留已知段键，非字符串值归一为空串', () => {
  const content = normalizeNoteContent({
    chiefComplaint: '发热咳嗽 2 天',
    presentIllness: '起病急，伴流涕',
    unknownKey: '应被忽略',
    pastHistory: 123,
    physicalExam: null,
  });
  assert.equal(content.chiefComplaint, '发热咳嗽 2 天');
  assert.equal(content.presentIllness, '起病急，伴流涕');
  assert.equal(content.pastHistory, '');
  assert.equal(content.physicalExam, '');
  assert.equal('unknownKey' in content, false, '未知键必须被丢弃');
  for (const key of NOTE_SECTION_KEYS) assert.equal(typeof content[key], 'string', `${key} 必须是字符串`);
});

test('normalizeNoteContent：空/非对象输入归一为全空段（宽容归一）', () => {
  for (const input of [null, undefined, 'text', 42, [], {}]) {
    const content = normalizeNoteContent(input);
    for (const key of NOTE_SECTION_KEYS) assert.equal(content[key], '');
  }
});

test('normalizeNoteContent：合法输入全保留且通过 schema 校验', () => {
  const content = normalizeNoteContent({ chiefComplaint: '咳嗽 3 天', treatmentPlan: '对症治疗' });
  assert.doesNotThrow(() => noteContentSchema.parse(content));
  assert.equal(content.treatmentPlan, '对症治疗');
});

test('sectionCompleteness：四态判定边界', () => {
  assert.equal(sectionCompleteness('', true), 'missing');
  assert.equal(sectionCompleteness('   ', true), 'missing');
  assert.equal(sectionCompleteness(undefined, true), 'missing');
  assert.equal(sectionCompleteness('', false), 'not_applicable');
  assert.equal(sectionCompleteness(undefined, false), 'not_applicable');
  assert.equal(sectionCompleteness('发热', true), 'partial');
  assert.equal(sectionCompleteness('一二三四五六七', true), 'partial', '7 字仍为片段');
  assert.equal(sectionCompleteness('一二三四五六七八', true), 'written', '8 字及以上为完整');
});

test('noteContentSchema：未知键与非字符串值拒绝', () => {
  const valid = normalizeNoteContent({ chiefComplaint: 'x' });
  assert.doesNotThrow(() => noteContentSchema.parse(valid));
  assert.throws(() => noteContentSchema.parse({ ...valid, evil: 'x' }), '未知键必须拒绝');
  assert.throws(() => noteContentSchema.parse({ ...valid, chiefComplaint: 9 }), '非字符串值必须拒绝');
});

test('模板结构：版本、必填段与键白名单一致', () => {
  assert.equal(NOTE_TEMPLATE_VERSION, 'pediatric-general-v1');
  const required = NOTE_TEMPLATE.filter((section) => section.required).map((section) => section.key);
  assert.deepEqual(required, ['chiefComplaint', 'presentIllness', 'pastHistory', 'physicalExam', 'preliminaryDiagnosis']);
  for (const section of NOTE_TEMPLATE) {
    assert.ok(NOTE_SECTION_KEYS.includes(section.key), `${section.key} 必须在白名单中`);
    assert.ok(section.label.length > 0);
    assert.ok(section.hint.length > 0);
  }
  assert.equal(NOTE_TEMPLATE.length, NOTE_SECTION_KEYS.length, '模板与白名单一一对应');
});
