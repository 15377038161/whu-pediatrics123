import { z } from 'zod';

const stage = z.enum(['triage', 'history', 'exam', 'tests', 'assessment', 'plan', 'communication', 'report']);

export const createSessionSchema = z.object({
  mode: z.enum(['guided', 'practice', 'osce']),
  caseId: z.enum(['peds-respiratory-001', 'peds-wheeze-002']).optional(),
  focus: z.enum(['history', 'exam', 'safety', 'communication']).optional(),
});

export const agentTurnSchema = z.object({
  sessionId: z.string().uuid(),
  clientEventId: z.string().min(8).max(100),
  event: z.discriminatedUnion('type', [
    z.object({ type: z.literal('ASK_QUESTION'), data: z.object({ text: z.string().trim().min(1).max(500) }) }),
    z.object({ type: z.literal('DOCTOR_INTERVENTION'), data: z.object({ action: z.enum(['child_answer', 'pause_parent', 'comfort_child']) }) }),
    z.object({ type: z.literal('EXAM_ACTION'), data: z.object({ toolId: z.string().min(1).max(60), bodyPartId: z.string().min(1).max(60) }) }),
    z.object({ type: z.literal('ORDER_TEST'), data: z.object({ testId: z.string().min(1).max(60) }) }),
    z.object({ type: z.literal('SUBMIT_DECISION'), data: z.object({ diagnosis: z.string().trim().min(2).max(200), summary: z.string().trim().min(10).max(1500), differentials: z.string().trim().max(800) }) }),
    z.object({ type: z.literal('SUBMIT_PLAN'), data: z.object({ priority: z.string().trim().min(2).max(300), detail: z.string().trim().min(5).max(1500) }) }),
    z.object({ type: z.literal('SEND_COMMUNICATION'), data: z.object({ text: z.string().trim().min(2).max(1000) }) }),
    z.object({ type: z.literal('NAVIGATE_STAGE'), data: z.object({ stage }) }),
    z.object({ type: z.literal('FINISH_SESSION'), data: z.object({}).strict() }),
  ]),
});
