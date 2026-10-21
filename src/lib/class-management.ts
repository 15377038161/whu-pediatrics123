import { z } from 'zod';
import { rosterRowSchema } from '@/lib/class-roster';

// requestId：幂等键，服务端要求 trim 后 8–64 字符，重复提交不重复执行
const requestIdSchema = z.string().trim().min(8).max(64);

export const classActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('import'), classId: z.string().uuid(), rows: z.array(rosterRowSchema).min(1).max(500) }),
  z.object({ action: z.literal('initial_select'), cohortId: z.string().uuid(), requestId: requestIdSchema }),
  z.object({ action: z.literal('skip'), requestId: requestIdSchema }),
  z.object({ action: z.literal('change_once'), cohortId: z.string().uuid(), requestId: requestIdSchema }),
  z.object({ action: z.literal('archive'), classId: z.string().uuid(), confirmed: z.literal(true) }),
]);

// 学生自助动作（首次自选/跳过/一次换班）与教师管理动作分置；旧 request/review 流程已停用，
// 其 RPC 执行权限已在迁移中撤销，schema 不再接受，返回 INVALID_INPUT。
const STUDENT_SELF_ACTIONS = new Set(['initial_select', 'skip', 'change_once']);

export function isStudentSelfAction(input: z.infer<typeof classActionSchema>): boolean {
  return STUDENT_SELF_ACTIONS.has(input.action);
}

export function classActionRpc(input: z.infer<typeof classActionSchema>) {
  switch (input.action) {
    case 'create': return { name: 'class_create', args: { p_name: input.name } };
    case 'import': return { name: 'class_import_roster', args: { p_class_id: input.classId, p_rows: input.rows } };
    case 'initial_select': return { name: 'class_initial_select', args: { p_cohort_id: input.cohortId, p_request_id: input.requestId } };
    case 'skip': return { name: 'class_skip_guest', args: { p_request_id: input.requestId } };
    case 'change_once': return { name: 'class_change_once', args: { p_cohort_id: input.cohortId, p_request_id: input.requestId } };
    case 'archive': return { name: 'class_archive', args: { p_class_id: input.classId, p_confirmed: input.confirmed } };
  }
}

export const teacherAccessSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('grant'), userId: z.string().uuid(), cxid: z.string().regex(/^\d{1,32}$/), confirmed: z.literal(true) }),
  z.object({ action: z.literal('revoke'), userId: z.string().uuid(), confirmed: z.literal(true) }),
]);
