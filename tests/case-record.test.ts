import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentMessage, ClinicalEvent } from '@/domain/agent';
import { getCaseRecordEntries, searchCaseRecordEntries } from '@/domain/case-record';

function event(id: string, type: ClinicalEvent['type'], summary: string, createdAt: string, evidenceCodes = ['EVIDENCE']): ClinicalEvent {
  return { id, clientEventId: `client-${id}`, type, stage: type === 'ASK_QUESTION' ? 'history' : type === 'ORDER_TEST' ? 'tests' : 'exam', summary, correct: true, evidenceCodes, createdAt };
}

function message(id: string, actor: AgentMessage['actor'], content: string, createdAt: string): AgentMessage {
  return { id, actor, content, emotion: 'neutral', kind: 'dialogue', createdAt };
}

const events = [
  event('e1', 'ASK_QUESTION', '依据病例正文回答：咳嗽几天了？', '2026-01-01T00:00:02.000Z'),
  event('e2', 'EXAM_ACTION', '听诊胸部：右下肺细湿啰音', '2026-01-01T00:00:05.000Z'),
  event('e3', 'ORDER_TEST', '血常规：白细胞升高', '2026-01-01T00:00:06.000Z'),
];
const messages = [
  message('m1', 'student', '咳嗽几天了？', '2026-01-01T00:00:01.000Z'),
  message('m2', 'child', '咳嗽两天。', '2026-01-01T00:00:02.000Z'),
  message('m3', 'parent', '昨晚开始加重。', '2026-01-01T00:00:03.000Z'),
  message('m4', 'system', '不应进入问诊回答的内部提示', '2026-01-01T00:00:04.000Z'),
];

test('共享记录只使用已释放事件及本会话实际parent/child回答', () => {
  const entries = getCaseRecordEntries({ events, messages });
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.category), ['history', 'exam', 'test']);
  assert.equal(entries[0].question, '咳嗽几天了？');
  assert.deepEqual(entries[0].answers, [
    { actor: 'child', content: '咳嗽两天。' },
    { actor: 'parent', content: '昨晚开始加重。' },
  ]);
  assert.equal(entries.flatMap((entry) => entry.answers).some((answer) => answer.content.includes('内部提示')), false);
});

test('共享记录分类与搜索覆盖问题、实际回答和检查结果', () => {
  const entries = getCaseRecordEntries({ events, messages });
  assert.equal(searchCaseRecordEntries(entries, 'history', '加重').length, 1);
  assert.equal(searchCaseRecordEntries(entries, 'exam', '湿啰音').length, 1);
  assert.equal(searchCaseRecordEntries(entries, 'test', '白细胞').length, 1);
  assert.equal(searchCaseRecordEntries(entries, 'all', '咳嗽').length, 1);
  assert.equal(searchCaseRecordEntries(entries, 'all', '不存在').length, 0);
});

test('无有效证据的问诊与未关联学生消息不产生虚构回答', () => {
  const noEvidence = event('empty', 'ASK_QUESTION', '依据病例正文回答：未解锁问题', '2026-01-01T00:00:02.000Z', []);
  assert.equal(getCaseRecordEntries({ events: [noEvidence], messages }).length, 0);
  const orphan = event('orphan', 'ASK_QUESTION', '依据病例正文回答：没有对应学生消息', '2026-01-01T00:00:02.000Z');
  const [entry] = getCaseRecordEntries({ events: [orphan], messages });
  assert.deepEqual(entry.answers, []);
});
