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

test('1385 测试单位旧会话会重新归类为教师', () => {
  const user = userWithIdentity('1385', [{ roleId: '102', roleName: '学生' }], 'student');
  assert.equal(normalizeSupabaseUser(user).role, 'teacher');
});
