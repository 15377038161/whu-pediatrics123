import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from '@supabase/supabase-js';
import { normalizeSupabaseUser } from '@/lib/supabase-auth';

function userWithIdentity(fid: string, role: Array<{ roleId: string; roleName: string }>, storedRole = 'student'): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    app_metadata: {
      app: { role: storedRole },
      chaoxing: { fid, uid: 'provider-user', displayName: '测试用户', role },
    },
    user_metadata: {},
  } as unknown as User;
}

test('旧会话中的 1024 教师会按原始超星角色重新归类为教师', () => {
  const user = userWithIdentity('1024', [{ roleId: '101', roleName: '教师' }], 'student');
  assert.equal(normalizeSupabaseUser(user).role, 'teacher');
});

test('1024 学生不会因旧的 app.role 被错误提升为教师', () => {
  const user = userWithIdentity('1024', [{ roleId: '102', roleName: '学生' }], 'teacher');
  assert.equal(normalizeSupabaseUser(user).role, 'student');
});

test('1385 测试单位学生角色不再凭机构 ID 提升为教师（安全修正后）', () => {
  const saved = process.env.CHAOXING_TEST_TEACHER_UIDS;
  process.env.CHAOXING_TEST_TEACHER_UIDS = '';
  try {
    const user = userWithIdentity('1385', [{ roleId: '102', roleName: '学生' }], 'student');
    assert.equal(normalizeSupabaseUser(user).role, 'student');
  } finally {
    if (saved === undefined) delete process.env.CHAOXING_TEST_TEACHER_UIDS;
    else process.env.CHAOXING_TEST_TEACHER_UIDS = saved;
  }
});

test('1385 测试单位教师角色经完整链路归为教师（可信服务端角色正例）', () => {
  const user = userWithIdentity('1385', [{ roleId: '101', roleName: '教师' }], 'student');
  assert.equal(normalizeSupabaseUser(user).role, 'teacher');
});

test('1385 显式测试教师 UID 白名单经完整链路归为教师（无角色时唯一提权途径）', () => {
  const saved = process.env.CHAOXING_TEST_TEACHER_UIDS;
  process.env.CHAOXING_TEST_TEACHER_UIDS = 'provider-user';
  try {
    const user = userWithIdentity('1385', [{ roleId: '102', roleName: '学生' }], 'student');
    assert.equal(normalizeSupabaseUser(user).role, 'teacher');
  } finally {
    if (saved === undefined) delete process.env.CHAOXING_TEST_TEACHER_UIDS;
    else process.env.CHAOXING_TEST_TEACHER_UIDS = saved;
  }
});

test('来源无效负例：无超星身份回退 app_metadata.app.role，不伪造教师', () => {
  const emailTeacher = {
    id: '00000000-0000-4000-8000-000000000002',
    app_metadata: { app: { role: 'teacher' } },
    user_metadata: {},
  } as unknown as User;
  const emailStudent = {
    id: '00000000-0000-4000-8000-000000000003',
    app_metadata: { app: { role: 'student' } },
    user_metadata: {},
  } as unknown as User;
  const noRole = {
    id: '00000000-0000-4000-8000-000000000004',
    app_metadata: {},
    user_metadata: {},
  } as unknown as User;
  assert.equal(normalizeSupabaseUser(emailTeacher).role, 'teacher');
  assert.equal(normalizeSupabaseUser(emailStudent).role, 'student');
  assert.equal(normalizeSupabaseUser(noRole).role, 'student');
});
