import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANK_STATUS_TRANSITIONS,
  canTransitionBankStatus,
  isUuid,
} from '@/lib/question-bank';
import {
  generationBatchSchema,
  parseGeneratedQuestions,
  generateQuestions,
} from '@/lib/question-generation';
import { updateItemSchema, updateBankSchema, createBankSchema, publishBankSchema } from '@/lib/question-bank-api';
import { errorFromUnknown } from '@/lib/api-result';

const UUID = '00000000-0000-4000-8000-000000000001';

/** 题集状态迁移白名单镜像迁移语义：published 只能经发布 RPC 达成，不能直接置位。 */
test('题集状态迁移白名单：published 不可直接设定，下架/恢复闭环可用', () => {
  assert.equal(canTransitionBankStatus('draft', 'ready_for_review'), true);
  assert.equal(canTransitionBankStatus('ready_for_review', 'draft'), true);
  assert.equal(canTransitionBankStatus('published', 'retired'), true);
  assert.equal(canTransitionBankStatus('retired', 'draft'), true);
  // 关键安全断言：任何状态都不能经 updateBank 直达 published
  for (const from of Object.keys(BANK_STATUS_TRANSITIONS) as Array<keyof typeof BANK_STATUS_TRANSITIONS>) {
    assert.equal(canTransitionBankStatus(from, 'published'), false, `${from} -> published`);
  }
  // 非法迁移
  assert.equal(canTransitionBankStatus('draft', 'retired'), false);
  assert.equal(canTransitionBankStatus('draft', 'draft'), false);
});

test('updateBankSchema 拒绝 published 直写与多余字段', () => {
  assert.equal(updateBankSchema.safeParse({ status: 'published' }).success, false);
  assert.equal(updateBankSchema.safeParse({ status: 'ready_for_review' }).success, true);
  assert.equal(updateBankSchema.safeParse({ title: '新生儿黄疸专题', hack: 1 }).success, false);
  assert.equal(updateBankSchema.safeParse({ title: 'x' }).success, false);
});

test('createBankSchema 标题必填 2-120 字，字段严格', () => {
  assert.equal(createBankSchema.safeParse({ title: '腹泻补液专题' }).success, true);
  assert.equal(createBankSchema.safeParse({ title: 'x' }).success, false);
  assert.equal(createBankSchema.safeParse({ title: 'y'.repeat(121) }).success, false);
  assert.equal(createBankSchema.safeParse({ topic: '只有主题没有标题' }).success, false);
});

/** 编辑一致性：改选项必须连带答案；answer ∈ options；选项不可重复。 */
test('updateItemSchema 一致性校验：选项连带答案、答案∈选项、选项去重', () => {
  // 合法：同时提交选项与答案
  assert.equal(updateItemSchema.safeParse({
    options: ['静脉补液 20ml/kg', '口服补液盐', '观察', '输血'],
    answer: '口服补液盐',
  }).success, true);
  // 改选项不提交答案 → 拒绝
  assert.equal(updateItemSchema.safeParse({ options: ['A', 'B', 'C', 'D'] }).success, false);
  // 答案不在选项中 → 拒绝
  assert.equal(updateItemSchema.safeParse({ options: ['A', 'B', 'C', 'D'], answer: 'E' }).success, false);
  // 选项重复 → 拒绝
  assert.equal(updateItemSchema.safeParse({ options: ['A', 'A', 'C', 'D'], answer: 'A' }).success, false);
  // 单独提交答案（对既有选项）→ 允许（数据库 CHECK 兜底一致性）
  assert.equal(updateItemSchema.safeParse({ answer: 'B' }).success, true);
  // 审核 status 枚举受限
  assert.equal(updateItemSchema.safeParse({ reviewStatus: 'approved' }).success, true);
  assert.equal(updateItemSchema.safeParse({ reviewStatus: 'publish' }).success, false);
});

test('publishBankSchema 仅接受可见范围枚举', () => {
  assert.equal(publishBankSchema.safeParse({}).success, true);
  assert.equal(publishBankSchema.safeParse({ visibility: 'platform' }).success, true);
  assert.equal(publishBankSchema.safeParse({ visibility: 'public' }).success, false);
  assert.equal(publishBankSchema.safeParse({ visibility: 'own_class', extra: 1 }).success, false);
});

/** AI 生成结果校验：任何字段不合格即整批拒绝，不落半残题目。 */
test('parseGeneratedQuestions：合法批次通过；答案越界/选项重复/字段过短整批拒绝', () => {
  const valid = JSON.stringify([{
    stem: '足月儿生后 24 小时出现黄疸，首先考虑的鉴别是？',
    options: ['生理性黄疸', '新生儿溶血病', '母乳性黄疸', '胆道闭锁'],
    answer: '新生儿溶血病',
    explanation: '24 小时内出现的黄疸属病理性，首先警惕新生儿溶血病，需查母婴血型与胆红素。',
    knowledgePoint: '新生儿病理性黄疸',
    difficulty: 'hard',
  }]);
  assert.equal(parseGeneratedQuestions(valid).length, 1);

  // 答案不是选项之一
  const badAnswer = JSON.stringify([{
    stem: '题干内容足够长',
    options: ['A1', 'B1', 'C1', 'D1'],
    answer: 'E1',
    explanation: '解析内容足够长的说明文字',
    difficulty: 'easy',
  }]);
  assert.throws(() => parseGeneratedQuestions(badAnswer), /AI_GENERATION_INVALID/);

  // 选项重复
  const dupOptions = JSON.stringify([{
    stem: '题干内容足够长',
    options: ['A1', 'A1', 'C1', 'D1'],
    answer: 'A1',
    explanation: '解析内容足够长的说明文字',
    difficulty: 'easy',
  }]);
  assert.throws(() => parseGeneratedQuestions(dupOptions), /AI_GENERATION_INVALID/);

  // 解析过短
  const shortExplanation = JSON.stringify([{
    stem: '题干内容足够长',
    options: ['A1', 'B1', 'C1', 'D1'],
    answer: 'A1',
    explanation: '太短',
    difficulty: 'easy',
  }]);
  assert.throws(() => parseGeneratedQuestions(shortExplanation), /AI_GENERATION_INVALID/);

  // 非法难度值
  const badDifficulty = JSON.stringify([{
    stem: '题干内容足够长',
    options: ['A1', 'B1', 'C1', 'D1'],
    answer: 'A1',
    explanation: '解析内容足够长的说明文字',
    difficulty: 'extreme',
  }]);
  assert.throws(() => parseGeneratedQuestions(badDifficulty), /AI_GENERATION_INVALID/);

  // 非 JSON / 非数组
  assert.throws(() => parseGeneratedQuestions('不是 JSON'), /AI_GENERATION_INVALID/);
  assert.throws(() => parseGeneratedQuestions('{"a":1}'), /AI_GENERATION_INVALID/);
  assert.throws(() => parseGeneratedQuestions('[]'), /AI_GENERATION_INVALID/);
});

test('parseGeneratedQuestions：容忍代码块围栏与前后说明文字', () => {
  const wrapped = '以下是生成的题目：\n```json\n[{"stem":"题干内容是足够长的","options":["A1","B1","C1","D1"],"answer":"A1","explanation":"解析内容足够长的说明文字","difficulty":"easy"}]\n```\n请查收';
  assert.equal(parseGeneratedQuestions(wrapped).length, 1);
});

test('generateQuestions：数量不足即拒绝；超出部分截断到请求数量', async () => {
  const twoItems = JSON.stringify([
    { stem: '题干一内容足够长', options: ['A1', 'B1', 'C1', 'D1'], answer: 'A1', explanation: '解析内容足够长的说明文字一', difficulty: 'easy' },
    { stem: '题干二内容足够长', options: ['A2', 'B2', 'C2', 'D2'], answer: 'A2', explanation: '解析内容足够长的说明文字二', difficulty: 'easy' },
  ]);
  await assert.rejects(
    generateQuestions(
      { topic: '小儿肺炎', count: 3, difficulty: 'mixed', requestId: UUID },
      { invokeAI: async () => twoItems },
    ),
    /AI_GENERATION_INVALID/,
  );

  const threeItems = `${twoItems.slice(0, -1)},{stem:'x'}]`.replace("{stem:'x'}", JSON.stringify({ stem: '题干三内容足够长', options: ['A3', 'B3', 'C3', 'D3'], answer: 'A3', explanation: '解析内容足够长的说明文字三', difficulty: 'easy' }));
  const trimmed = await generateQuestions(
    { topic: '小儿肺炎', count: 3, difficulty: 'mixed', requestId: UUID },
    { invokeAI: async () => threeItems },
  );
  assert.equal(trimmed.questions.length, 3);
});

test('generationBatchSchema：主题必填、数量 3-10、requestId 必须为 UUID', () => {
  assert.equal(generationBatchSchema.safeParse({ topic: '小儿腹泻补液', count: 5, requestId: UUID }).success, true);
  assert.equal(generationBatchSchema.safeParse({ topic: '小儿腹泻补液', count: 2, requestId: UUID }).success, false);
  assert.equal(generationBatchSchema.safeParse({ topic: '小儿腹泻补液', count: 11, requestId: UUID }).success, false);
  assert.equal(generationBatchSchema.safeParse({ topic: 'x', count: 5, requestId: UUID }).success, false);
  assert.equal(generationBatchSchema.safeParse({ topic: '小儿腹泻补液', count: 5, requestId: 'not-a-uuid' }).success, false);
  assert.equal(generationBatchSchema.safeParse({ topic: '小儿腹泻补液', count: 5 }).success, false);
});

test('isUuid 只接受标准 UUID 形态', () => {
  assert.equal(isUuid(UUID), true);
  assert.equal(isUuid('short'), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(`${UUID}%20OR%201=1`), false);
});

/** 错误映射镜像迁移 RPC 语义：发布前置校验/幂等判分/权限异常都有明确文案。 */
test('题库错误映射：发布校验/批次关闭/生成无效/删除保护', () => {
  assert.equal(errorFromUnknown(new Error('NO_APPROVED_ITEMS')).code, 'NO_APPROVED_ITEMS');
  assert.equal(errorFromUnknown(new Error('DUPLICATE_OPTIONS')).code, 'DUPLICATE_OPTIONS');
  assert.equal(errorFromUnknown(new Error('BANK_HAS_VERSIONS')).code, 'BANK_HAS_VERSIONS');
  assert.equal(errorFromUnknown(new Error('BANK_NOT_FOUND')).code, 'BANK_NOT_FOUND');
  assert.equal(errorFromUnknown(new Error('ITEM_NOT_FOUND')).code, 'ITEM_NOT_FOUND');
  assert.equal(errorFromUnknown(new Error('ATTEMPT_CLOSED')).code, 'ATTEMPT_CLOSED');
  assert.equal(errorFromUnknown(new Error('INVALID_VISIBILITY')).code, 'INVALID_VISIBILITY');
  const generation = errorFromUnknown(new Error('AI_GENERATION_INVALID:第 2 题校验失败（选项存在重复）'));
  assert.equal(generation.code, 'AI_GENERATION_INVALID');
  assert.equal(generation.retryable, true);
  // 既有映射不被本批改动破坏
  assert.equal(errorFromUnknown(new Error('FORBIDDEN')).code, 'FORBIDDEN');
  assert.equal(errorFromUnknown(new Error('AUTH_REQUIRED')).code, 'AUTH_REQUIRED');
  assert.equal(errorFromUnknown(new Error('INVALID_REQUEST')).code, 'INVALID_REQUEST');
});
