import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWhitelistTeacherRole } from '../src/lib/request-auth';

/**
 * 教师白名单门禁决策测试（统一应用/API/RLS 门禁）：
 * - 白名单判定来自服务端 app_is_teacher RPC（与 RLS 谓词同源），客户端传入的 email/uid/role 不参与；
 * - 邮箱所有权风险：白名单命中但邮箱未经服务端确认（email_confirmed_at 为空，如他人抢注
 *   白名单邮箱的未验证账号）→ 不得提升；
 * - RPC 结果未知（null：调用失败/异常/无 token/未配置数据库）→ fail-closed 不提升；
 * - 既有教师（超星 OAuth 教师身份/应用层角色/预览教师）保持教师，不依赖白名单。
 */
test('白名单命中且邮箱所有权经服务端确认 → 提升为教师', () => {
  assert.equal(resolveWhitelistTeacherRole('student', true, true), 'teacher');
});

test('白名单命中但邮箱未确认（抢注风险） → 不提升', () => {
  assert.equal(resolveWhitelistTeacherRole('student', false, true), 'student');
});

test('邮箱已确认但白名单未命中 → 不提升', () => {
  assert.equal(resolveWhitelistTeacherRole('student', true, false), 'student');
});

test('RPC 结果未知（null：调用失败/异常/无 token） → fail-closed 不提升', () => {
  assert.equal(resolveWhitelistTeacherRole('student', true, null), 'student');
  assert.equal(resolveWhitelistTeacherRole('student', false, null), 'student');
});

test('既有教师保持教师（不依赖白名单结果）', () => {
  assert.equal(resolveWhitelistTeacherRole('teacher', false, null), 'teacher');
  assert.equal(resolveWhitelistTeacherRole('teacher', true, false), 'teacher');
});

test('学生任何白名单不满足组合均保持学生', () => {
  assert.equal(resolveWhitelistTeacherRole('student', false, false), 'student');
  assert.equal(resolveWhitelistTeacherRole('student', true, false), 'student');
});
