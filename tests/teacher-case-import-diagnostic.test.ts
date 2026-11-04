import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileTeacherCaseImportDiagnostic } from '@/lib/teacher-case-import';

const CURRENT = '0000000000000000';
const HISTORICAL = 'ffffffffffffffff';
const OTHER = '1111111111111111';

test('教师诊断按固定包精确版本核对，不被字典序更大的历史哈希遮蔽', () => {
  const result = reconcileTeacherCaseImportDiagnostic([
    { case_id: 'teacher-川崎病', version: HISTORICAL },
    { case_id: 'teacher-川崎病', version: CURRENT },
    { case_id: 'teacher-肾病综合征', version: HISTORICAL },
    { case_id: 'teacher-肺炎支原体肺炎', version: OTHER },
  ], (caseId) => {
    if (caseId === 'teacher-川崎病' || caseId === 'teacher-肾病综合征') return CURRENT;
    return null;
  });

  assert.equal(result.total, 53);
  assert.equal(result.loaded, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.missingLocal, 1);
  assert.equal(result.noSource, 50);
  assert.deepEqual(result.cases.find((item) => item.caseId === 'teacher-川崎病'), {
    caseId: 'teacher-川崎病',
    localVersion: CURRENT,
    dbVersion: CURRENT,
    status: 'loaded',
  });
  assert.equal(result.cases.find((item) => item.caseId === 'teacher-肾病综合征')?.status, 'pending');
  assert.equal(result.cases.find((item) => item.caseId === 'teacher-肺炎支原体肺炎')?.status, 'missing_local');
});
