import assert from 'node:assert/strict';
import test from 'node:test';
import { groundCaseAnswerKey, type CaseAnswerKeyRecord } from '../src/domain/case-analysis';
import { dkaGeneratedKey, dkaSource } from './fixtures/dka-case-analysis';
import { recordToRow, rowToRecord } from '../src/lib/case-answer-key-store';

function autoRecord(): CaseAnswerKeyRecord {
  const grounded = groundCaseAnswerKey(dkaGeneratedKey, dkaSource);
  assert.ok('key' in grounded);
  return {
    caseId: 'teacher-1型糖尿病伴有酮症酸中毒',
    version: 'a'.repeat(16),
    status: 'auto',
    key: grounded.key,
    model: 'test-model',
    promptVersion: 'case-analysis-v1',
    sourceFingerprint: 'a'.repeat(16),
    generatedAt: '2026-11-06T00:00:00.000Z',
    dropped: grounded.dropped,
  };
}

test('标答记录与数据库行可往返', () => {
  const record = autoRecord();
  const row = recordToRow(record);
  assert.equal(row.case_id, record.caseId);
  assert.equal(row.key_json?.primary.name, '1型糖尿病伴有酮症酸中毒');
  const back = rowToRecord(row);
  assert.ok(back);
  assert.equal(back.caseId, record.caseId);
  assert.equal(back.status, 'auto');
  assert.equal(back.key?.evidence.length, 6);
});

test('not_assessable 记录不携带 key_json 也能回读', () => {
  const record: CaseAnswerKeyRecord = {
    caseId: 'teacher-x',
    version: 'b'.repeat(16),
    status: 'not_assessable',
    key: null,
    model: 'test-model',
    promptVersion: 'case-analysis-v1',
    sourceFingerprint: 'b'.repeat(16),
    generatedAt: '2026-11-06T00:00:00.000Z',
    reason: 'PRIMARY_NOT_GROUNDED',
    dropped: [{ section: 'primary', label: '支气管肺炎', reason: '诊断名不在原件诊断段' }],
  };
  const back = rowToRecord(recordToRow(record));
  assert.ok(back);
  assert.equal(back.status, 'not_assessable');
  assert.equal(back.key, null);
  assert.equal(back.reason, 'PRIMARY_NOT_GROUNDED');
});

test('缺字段或非法状态的行按无记录处理，不抛错', () => {
  assert.equal(rowToRecord(null), null);
  assert.equal(rowToRecord({ case_id: 'x' }), null);
  assert.equal(rowToRecord({ ...recordToRow(autoRecord()), status: 'unknown' }), null);
});