import test from 'node:test';
import assert from 'node:assert/strict';
import { isProjectionStale } from '../src/lib/case-snapshot';

/** 会话作用域投影过期检测（查体修复配套）：
 *  恢复态缓存为剥离投影（exam/tests 空串），学生真实执行查体/开单后 RPC 门控已放行，
 *  缓存未刷新时引擎规则匹配会假阴性（有记录却判资料未提供/检查不存在）。 */

function makeCached(overrides?: { exam?: string; tests?: string }) {
  return {
    caseId: 'teacher-x', sourceName: 'x', sourceDocument: 'x',
    age: '1岁', sex: '男', complaint: 'x',
    sections: {
      history: 'h', exam: overrides?.exam ?? '', tests: overrides?.tests ?? '',
      diagnosis: '', plan: '',
    },
    vitals: { temperature: null, heartRate: null, respiratoryRate: null, spo2: null },
    documents: [],
  };
}

test('无缓存不算过期（正常路径：本地文件/共享键，无恢复态缓存）', () => {
  assert.equal(isProjectionStale(null, { hasExam: true, hasTests: true }), false);
  assert.equal(isProjectionStale(undefined, { hasExam: true, hasTests: true }), false);
});

test('已执行查体但缓存 exam 仍剥离 → 过期（需刷新）', () => {
  assert.equal(isProjectionStale(makeCached(), { hasExam: true, hasTests: false }), true);
});

test('已执行查体且 exam 已扩展 → 不过期', () => {
  assert.equal(isProjectionStale(makeCached({ exam: 'T 38.5℃ …' }), { hasExam: true, hasTests: false }), false);
});

test('已开单但缓存 tests 仍剥离 → 过期（需刷新）', () => {
  assert.equal(isProjectionStale(makeCached(), { hasExam: false, hasTests: true }), true);
});

test('已开单且 tests 已扩展 → 不过期', () => {
  assert.equal(isProjectionStale(makeCached({ tests: '血常规…' }), { hasExam: false, hasTests: true }), false);
});

test('查体已扩展但检查仍剥离 → 过期（部分剥离即刷新）', () => {
  assert.equal(isProjectionStale(makeCached({ exam: 'T 38.5℃ …' }), { hasExam: true, hasTests: true }), true);
});

test('无任何证据时剥离态不算过期（剥离即门控语义本身）', () => {
  assert.equal(isProjectionStale(makeCached(), { hasExam: false, hasTests: false }), false);
});
