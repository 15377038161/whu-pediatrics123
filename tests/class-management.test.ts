import assert from 'node:assert/strict';
import test from 'node:test';
import { classActionSchema, classActionRpc, teacherAccessSchema } from '@/lib/class-management';
import { classManagementError } from '@/lib/class-management-error';

test('管理请求不接受仅 cxid 自动提权；必须确认具体账号', () => {
  assert.equal(teacherAccessSchema.safeParse({ action: 'grant', cxid: '123', confirmed: true }).success, false);
  assert.equal(teacherAccessSchema.safeParse({ action: 'grant', cxid: '123', userId: '00000000-0000-4000-8000-000000000001', confirmed: false }).success, false);
  const input=classActionSchema.parse({ action: 'request', classId: '00000000-0000-4000-8000-000000000001', userId: 'someone-else' });
  assert(input.action === 'request');
  assert.deepEqual(classActionRpc(input), { name: 'class_request_join', args: { p_class_id: input.classId, p_student_no: '' } });
});
test('数据库拒绝、格式错误与不可用服务区分，异常正文不泄漏', async () => {
  assert.equal(classManagementError(new Error('FORBIDDEN')).status,403);
  const response=classManagementError({ message: 'private SQL patient content', code: 'XX000' });
  assert.equal(response.status,503);
  assert.equal(JSON.stringify(await response.json()).includes('private SQL'),false);
  assert.equal(classManagementError({code:'23505'}).status,409);
});
