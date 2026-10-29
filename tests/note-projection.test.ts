import assert from 'node:assert/strict';
import test from 'node:test';
import { noteRevisionIndexMap, projectNoteForRole } from '../src/lib/note-projection';
import { normalizeNoteContent, type NoteReviewResult, type NoteSubmissionRecord } from '../src/domain/medical-note';

/** 批次6·病历提交角色投影与版本序号（防透题边界）。 */

function makeRecord(overrides?: Partial<NoteSubmissionRecord>): NoteSubmissionRecord {
  return {
    id: 'note-1',
    userId: 'user-1',
    sessionId: 'session-1',
    caseId: 'teacher-川崎病',
    caseVersion: 'abcdef0123456789',
    templateVersion: 'pediatric-general-v1',
    content: normalizeNoteContent({ chiefComplaint: '发热 2 天' }),
    clientEventId: null,
    submittedAt: '2026-10-29T10:00:00.000Z',
    aiReviewStatus: 'pending',
    aiReview: null,
    aiPromptVersion: null,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  };
}

test('学生投影：不含 caseId/caseVersion（内部 teacher-<病名> 防透题边界）', () => {
  const view = projectNoteForRole(makeRecord(), 'student');
  assert.equal('caseId' in view, false);
  assert.equal('caseVersion' in view, false);
  assert.equal(view.id, 'note-1');
  assert.equal(view.sessionId, 'session-1');
  assert.equal(view.content.chiefComplaint, '发热 2 天');
  assert.equal(view.aiReviewStatus, 'pending');
});

test('教师投影：含病例绑定与 AI 意见', () => {
  const review: NoteReviewResult = { summary: '结构完整', sections: [], notableStrengths: ['书写认真'] };
  const view = projectNoteForRole(makeRecord({ aiReviewStatus: 'ready', aiReview: review }), 'teacher');
  assert.equal(view.caseId, 'teacher-川崎病');
  assert.equal(view.caseVersion, 'abcdef0123456789');
  assert.deepEqual(view.aiReview, review);
});

test('revisionIndex：按提交时间升序编号（1=首次提交）', () => {
  const records = [
    makeRecord({ id: 'b', submittedAt: '2026-10-29T11:00:00.000Z' }),
    makeRecord({ id: 'a', submittedAt: '2026-10-29T10:00:00.000Z' }),
    makeRecord({ id: 'c', submittedAt: '2026-10-29T12:00:00.000Z' }),
  ];
  const index = noteRevisionIndexMap(records);
  assert.equal(index.get('a'), 1);
  assert.equal(index.get('b'), 2);
  assert.equal(index.get('c'), 3);
});

test('投影不修改原始记录（纯函数）', () => {
  const record = makeRecord();
  projectNoteForRole(record, 'student');
  projectNoteForRole(record, 'teacher');
  assert.equal(record.caseId, 'teacher-川崎病', '原始记录保持内部 caseId');
  assert.equal(record.content.chiefComplaint, '发热 2 天');
});
