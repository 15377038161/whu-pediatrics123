import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessRole, isTeacherIdentityAllowed, isTestTeacherFid } from '@/lib/access-control';

const studentRole = [{ roleId: '102', roleName: '学生' }];
const teacherRole = [{ roleId: '101', roleName: '教师' }];

test('1385 测试机构账号可获得教师权限，即使超星返回学生角色', () => {
  assert.equal(isTeacherIdentityAllowed({ fid: '1385', uid: 'test-user', role: studentRole }, {}), true);
  assert.equal(isTestTeacherFid('1385', {}), true);
  assert.equal(isTestTeacherFid('1385', { CHAOXING_TEST_TEACHER_FIDS: '' }), true);
});

test('武汉大学普通学生不会获得教师权限或教师端入口', () => {
  assert.equal(isTeacherIdentityAllowed({ fid: '1024', uid: 'student-user', role: studentRole }, {}), false);
  assert.equal(isTestTeacherFid('1024', {}), false);
  assert.equal(canAccessRole('student', 'teacher'), false);
});

test('普通机构教师仍需同时满足教师角色与 UID 白名单', () => {
  const env = { CHAOXING_TEACHER_UIDS: 'allowed-teacher' };
  assert.equal(isTeacherIdentityAllowed({ fid: '1024', uid: 'allowed-teacher', role: teacherRole }, env), true);
  assert.equal(isTeacherIdentityAllowed({ fid: '1024', uid: 'other-teacher', role: teacherRole }, env), false);
});

test('教师身份可进入学生端和教师端，学生身份只能进入学生端', () => {
  assert.equal(canAccessRole('teacher', 'student'), true);
  assert.equal(canAccessRole('teacher', 'teacher'), true);
  assert.equal(canAccessRole('student', 'student'), true);
  assert.equal(canAccessRole('student', 'teacher'), false);
});
