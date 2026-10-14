import assert from 'node:assert/strict';
import test from 'node:test';
import { teachingCopy, teachingHints, textbookSources } from '../src/domain/teaching-copy';
test('教材双页码与集中提示覆盖所有阶段，标语不承诺一次学会', () => {
  assert.equal(teachingCopy.safetyTitle, '儿童危重症识别');
  assert.equal(teachingCopy.slogan.includes('一次'), false);
  assert.equal(Object.keys(teachingHints).length, 8);
  for (const source of textbookSources) {
    assert.equal(source.printedPages.length, source.pdfPages.length);
    source.pdfPages.forEach((page, i) => assert.equal(page - source.printedPages[i], 27));
  }
  assert.ok(teachingHints.triage.some(text => text.includes('危重')));
  assert.ok(teachingHints.communication.some(text => text.includes('隐私')));
});
