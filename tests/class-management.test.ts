import assert from 'node:assert/strict';
import test from 'node:test';
import { classActionSchema, classActionRpc, isStudentSelfAction, teacherAccessSchema } from '@/lib/class-management';
import { classManagementError } from '@/lib/class-management-error';

const UUID = '00000000-0000-4000-8000-000000000001';

test('旧申请-审批流程停用：request/review 不再被 schema 接受', () => {
  assert.equal(classActionSchema.safeParse({ action: 'request', classId: UUID, studentNo: '' }).success, false);
  assert.equal(classActionSchema.safeParse({ action: 'review', requestId: UUID, approve: true }).success, false);
});

test('学生自助动作映射受控 RPC：initial_select/skip/change_once/archive', () => {
  const initial = classActionSchema.parse({ action: 'initial_select', cohortId: UUID, requestId: 'req-0001-abcd' });
  assert(initial.action === 'initial_select');
  assert.deepEqual(classActionRpc(initial), { name: 'class_initial_select', args: { p_cohort_id: UUID, p_request_id: 'req-0001-abcd' } });
  assert.equal(isStudentSelfAction(initial), true);

  const skip = classActionSchema.parse({ action: 'skip', requestId: 'req-0001-abcd' });
  assert(skip.action === 'skip');
  assert.deepEqual(classActionRpc(skip), { name: 'class_skip_guest', args: { p_request_id: 'req-0001-abcd' } });
  assert.equal(isStudentSelfAction(skip), true);

  const change = classActionSchema.parse({ action: 'change_once', cohortId: UUID, requestId: 'req-0001-abcd' });
  assert(change.action === 'change_once');
  assert.deepEqual(classActionRpc(change), { name: 'class_change_once', args: { p_cohort_id: UUID, p_request_id: 'req-0001-abcd' } });
  assert.equal(isStudentSelfAction(change), true);

  const archive = classActionSchema.parse({ action: 'archive', classId: UUID, confirmed: true });
  assert(archive.action === 'archive');
  assert.deepEqual(classActionRpc(archive), { name: 'class_archive', args: { p_class_id: UUID, p_confirmed: true } });
  assert.equal(isStudentSelfAction(archive), false);
});

test('幂等 requestId 必填且 8-64 字符（服务端同口径校验）', () => {
  assert.equal(classActionSchema.safeParse({ action: 'skip', requestId: 'short' }).success, false);
  assert.equal(classActionSchema.safeParse({ action: 'skip' }).success, false);
  assert.equal(classActionSchema.safeParse({ action: 'initial_select', cohortId: UUID, requestId: 'x'.repeat(65) }).success, false);
  // 归档必须显式二次确认
  assert.equal(classActionSchema.safeParse({ action: 'archive', classId: UUID, confirmed: false }).success, false);
});

test('管理请求不接受仅 cxid 自动提权；必须确认具体账号', () => {
  assert.equal(teacherAccessSchema.safeParse({ action: 'grant', cxid: '123', confirmed: true }).success, false);
  assert.equal(teacherAccessSchema.safeParse({ action: 'grant', cxid: '123', userId: UUID, confirmed: false }).success, false);
});

test('数据库拒绝、格式错误与不可用服务区分，异常正文不泄漏', async () => {
  assert.equal(classManagementError(new Error('FORBIDDEN')).status, 403);
  const response = classManagementError({ message: 'private SQL patient content', code: 'XX000' });
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(await response.json()).includes('private SQL'), false);
  assert.equal(classManagementError({ code: '23505' }).status, 409);
});

test('班级自助流程状态冲突错误映射到 409 与明确文案', async () => {
  for (const message of ['ALREADY_ONBOARDED', 'ALREADY_IN_CLASS', 'NOT_ONBOARDED', 'NO_CHANGE_REMAINING', 'AMBIGUOUS_MEMBERSHIP']) {
    const response = classManagementError(new Error(message));
    assert.equal(response.status, 409, message);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, message);
  }
});
