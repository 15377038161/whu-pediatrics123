import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessRole, isProviderTeacherFid, isTeacherIdentityAllowed, isTestTeacherFid } from '@/lib/access-control';

const studentRole = [{ roleId: '102', roleName: '学生' }];
const teacherRole = [{ roleId: '101', roleName: '教师' }];

test('学生 FID1385 负例：机构 ID 单独不再提权（安全修正后）', () => {
  assert.equal(isTeacherIdentityAllowed({ fid: '1385', uid: 'test-user', role: studentRole }, {}), false);
  assert.equal(isTeacherIdentityAllowed({ fid: '1385', uid: 'test-user', role: [] }, { CHAOXING_TEST_TEACHER_UIDS: 'someone-else' }), false);
  assert.equal(isTestTeacherFid('1385', {}), true);
});

test('1385 教师角色正例：可信服务端角色授予教师', () => {
  assert.equal(isTeacherIdentityAllowed({ fid: '1385', uid: 'test-user', role: teacherRole }, {}), true);
});

test('1385 显式测试教师 UID 白名单正例（无教师角色时的唯一提权途径）', () => {
  const env = { CHAOXING_TEST_TEACHER_UIDS: 'test-user' };
  assert.equal(isTeacherIdentityAllowed({ fid: '1385', uid: 'test-user', role: studentRole }, env), true);
  assert.equal(isTeacherIdentityAllowed({ fid: '1385', uid: 'other-user', role: studentRole }, env), false);
});

test('武汉大学普通学生不会获得教师权限或教师端入口', () => {
  assert.equal(isTeacherIdentityAllowed({ fid: '1024', uid: 'student-user', role: studentRole }, {}), false);
  assert.equal(isTestTeacherFid('1024', {}), false);
  assert.equal(canAccessRole('student', 'teacher'), false);
});

test('武汉大学教师按超星教师角色获得双端权限，不依赖 UID 白名单', () => {
  const env = { CHAOXING_TEACHER_UIDS: 'allowed-teacher' };
  assert.equal(isTeacherIdentityAllowed({ fid: '1024', uid: 'allowed-teacher', role: teacherRole }, env), true);
  assert.equal(isTeacherIdentityAllowed({ fid: '1024', uid: 'other-teacher', role: teacherRole }, env), true);
  assert.equal(isProviderTeacherFid('1024', {}), true);
});

test('武汉大学学生即使 UID 被误加白名单也不能获得教师权限', () => {
  const env = { CHAOXING_TEACHER_UIDS: 'student-user' };
  assert.equal(isTeacherIdentityAllowed({ fid: '1024', uid: 'student-user', role: studentRole }, env), false);
});

test('其他机构教师仍需同时满足教师角色与 UID 白名单', () => {
  const env = { CHAOXING_TEACHER_UIDS: 'allowed-teacher' };
  assert.equal(isTeacherIdentityAllowed({ fid: '2000', uid: 'allowed-teacher', role: teacherRole }, env), true);
  assert.equal(isTeacherIdentityAllowed({ fid: '2000', uid: 'other-teacher', role: teacherRole }, env), false);
});

test('教师身份可进入学生端和教师端，学生身份只能进入学生端', () => {
  assert.equal(canAccessRole('teacher', 'student'), true);
  assert.equal(canAccessRole('teacher', 'teacher'), true);
  assert.equal(canAccessRole('student', 'student'), true);
  assert.equal(canAccessRole('student', 'teacher'), false);
});
