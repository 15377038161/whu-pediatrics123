import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNoteReviewMessages, NOTE_REVIEW_PROMPT_VERSION, parseNoteReview } from '../src/lib/note-ai-review';
import { normalizeNoteContent } from '../src/domain/medical-note';
import type { ReleasedEvidenceSummary } from '../src/lib/note-evidence';

/** 批次6·AI 审阅提示词构造与结果校验（纯函数）。 */

const evidence: ReleasedEvidenceSummary = {
  evidence: [{ label: '体温', detail: '38.5℃', status: 'achieved' }],
  collection: [{ area: 'history', label: '问诊要点', available: 8, collected: 6 }],
  submissions: {
    diagnosis: '急性支气管炎',
    summary: null,
    diagnosisBasis: null,
    differentials: null,
    planPriority: null,
    planDetail: null,
    communication: null,
    historySummary: null,
    examFindings: null,
    examInterpretation: null,
  },
  strengths: [],
  improvements: [],
};

test('提示词构造：system + user 两消息，payload 含模板/内容/证据/标准段', () => {
  const messages = buildNoteReviewMessages({
    content: normalizeNoteContent({ chiefComplaint: '发热 2 天' }),
    evidence,
    standardSections: { history: '标准病史', exam: '标准查体', tests: '标准检查', diagnosis: '标准诊断', plan: '标准计划' },
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  const payload = JSON.parse(messages[1].content as string) as {
    template: Array<{ key: string; label: string; required: boolean }>;
    submittedContent: Record<string, string>;
    releasedEvidence: ReleasedEvidenceSummary;
    standardSections: Record<string, string>;
  };
  assert.equal(payload.submittedContent.chiefComplaint, '发热 2 天');
  assert.equal(payload.standardSections.diagnosis, '标准诊断');
  assert.ok(payload.template.length >= 10, '模板段落完整注入');
  assert.equal(payload.releasedEvidence.submissions.diagnosis, '急性支气管炎');
  assert.ok(payload.template.some((section) => section.key === 'chiefComplaint' && section.required));
});

test('parseNoteReview：裸 JSON 与 Markdown 代码块均可解析', () => {
  const review = { summary: '总体完整', sections: [], notableStrengths: ['认真'] };
  const plain = JSON.stringify(review);
  assert.deepEqual(parseNoteReview(plain), review);
  assert.deepEqual(parseNoteReview(`\`\`\`json\n${plain}\n\`\`\``), review);
});

test('parseNoteReview：非法/不完整输出返回 null（调用方标记 failed）', () => {
  assert.equal(parseNoteReview('抱歉，我无法完成审阅。'), null);
  assert.equal(parseNoteReview('{"summary": "缺字段"}'), null, '缺少 sections 必须拒绝');
  assert.equal(parseNoteReview(''), null);
  assert.equal(parseNoteReview('{无效 json'), null);
});

test('提示词版本常量', () => {
  assert.equal(NOTE_REVIEW_PROMPT_VERSION, 'v1');
});
