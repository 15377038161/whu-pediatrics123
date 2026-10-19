import { z } from 'zod';
import { rosterRowSchema } from '@/lib/class-roster';
export const classActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('import'), classId: z.string().uuid(), rows: z.array(rosterRowSchema).min(1).max(500) }),
  z.object({ action: z.literal('request'), classId: z.string().uuid(), studentNo: z.string().trim().max(64).default('') }),
  z.object({ action: z.literal('review'), requestId: z.string().uuid(), approve: z.boolean() }),
]);
export const teacherAccessSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('grant'), userId: z.string().uuid(), cxid: z.string().regex(/^\d{1,32}$/), confirmed: z.literal(true) }),
  z.object({ action: z.literal('revoke'), userId: z.string().uuid(), confirmed: z.literal(true) }),
]);
export function classActionRpc(input: z.infer<typeof classActionSchema>) {
  switch (input.action) {
    case 'create': return { name: 'class_create', args: { p_name: input.name } };
    case 'import': return { name: 'class_import_roster', args: { p_class_id: input.classId, p_rows: input.rows } };
    case 'request': return { name: 'class_request_join', args: { p_class_id: input.classId, p_student_no: input.studentNo } };
    case 'review': return { name: 'class_review_request', args: { p_request_id: input.requestId, p_approve: input.approve } };
  }
}
