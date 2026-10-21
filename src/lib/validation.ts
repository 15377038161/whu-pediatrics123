import { z } from 'zod';

const stage = z.enum(['triage', 'history', 'exam', 'tests', 'assessment', 'plan', 'communication', 'report']);

export const createSessionSchema = z.object({
  mode: z.enum(['guided', 'practice', 'osce', 'immersive']),
  caseId: z.string().trim().min(1).max(160).optional(),
  focus: z.enum(['history', 'exam', 'safety', 'communication']).optional(),
  random: z.boolean().optional(),
  excludeCaseId: z.string().trim().min(1).max(160).optional(),
  allowRepeat: z.boolean().optional(),
  clientRequestId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (value.random && (value.caseId || !value.clientRequestId || !['guided', 'immersive'].includes(value.mode))) context.addIssue({ code: 'custom', message: '随机接诊需请求标识且不能指定病例或考核模式' });
  if (!value.random && (value.excludeCaseId || value.allowRepeat)) context.addIssue({ code: 'custom', message: '排除与重练参数仅适用于随机接诊' });
});

export const speechAsrSchema = z
  .object({
    base64Data: z.string().min(8).max(Math.ceil((10 * 1024 * 1024) / 3) * 4),
    format: z.enum(['wav', 'mp3', 'ogg_opus', 'm4a']),
  })
  .strict();

export const speechTtsSchema = z
  .object({
    sessionId: z.string().uuid(),
    messageId: z.string().min(1).max(100),
  })
  .strict();

const eventSpeechMetaSchema = z
  .object({
    inputMode: z.literal('voice'),
    asrRawText: z.string().trim().min(1).max(600),
    transcriptEdited: z.boolean(),
  })
  .strict();

export const agentTurnSchema = z.object({
  sessionId: z.string().uuid(),
  clientEventId: z.string().min(8).max(100),
  event: z.discriminatedUnion('type', [
    z.object({ type: z.literal('ASK_QUESTION'), data: z.object({ text: z.string().trim().min(1).max(500), speech: eventSpeechMetaSchema.optional() }).strict() }),
    z.object({ type: z.literal('DOCTOR_INTERVENTION'), data: z.object({ action: z.enum(['child_answer', 'pause_parent', 'comfort_child']) }) }),
    z.object({ type: z.literal('EXAM_ACTION'), data: z.object({ toolId: z.string().min(1).max(60), bodyPartId: z.string().min(1).max(60), posture: z.enum(['standing', 'supine']).optional() }) }),
    // 任务2 双契约：学生自主文本申请（requestedTests，一次可多项，服务端确定性匹配）；
    // 旧 testId 点选路径保留兼容（历史会话续答/既有测试），二者互斥、strict 防字段混用。
    z.object({
      type: z.literal('ORDER_TEST'),
      data: z.union([
        z.object({ testId: z.string().min(1).max(60) }).strict(),
        z.object({ requestedTests: z.string().trim().min(1).max(400), reason: z.string().trim().max(300).optional() }).strict(),
      ]),
    }),
    z.object({ type: z.literal('SUBMIT_DECISION'), data: z.object({ diagnosis: z.string().trim().min(2).max(200), summary: z.string().trim().min(10).max(1500), diagnosisBasis: z.string().trim().min(10).max(1500), differentials: z.string().trim().max(800) }) }),
    z.object({ type: z.literal('SUBMIT_HISTORY_SUMMARY'), data: z.object({ summary: z.string().trim().min(10).max(1500) }) }),
    // 查体专项观察/解释提交（C-观察与报告-04）：观察所见必填（服务端另校验已解锁查体证据与
    // 配置版本），解释可选；strict 防字段混用，客户端不自报得分或解锁事实。
    z.object({ type: z.literal('SUBMIT_EXAM_OBSERVATION'), data: z.object({ findings: z.string().trim().min(10).max(1500), interpretation: z.string().trim().max(1500).optional() }).strict() }),
    z.object({ type: z.literal('SUBMIT_PLAN'), data: z.object({ priority: z.string().trim().min(2).max(300), detail: z.string().trim().min(5).max(1500) }) }),
    z.object({ type: z.literal('SEND_COMMUNICATION'), data: z.object({ text: z.string().trim().min(2).max(1000), speech: eventSpeechMetaSchema.optional() }).strict() }),
    z.object({ type: z.literal('NAVIGATE_STAGE'), data: z.object({ stage }) }),
    z.object({ type: z.literal('FINISH_SESSION'), data: z.object({}).strict() }),
  ]),
});
