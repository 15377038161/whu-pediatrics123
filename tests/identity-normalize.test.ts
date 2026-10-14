import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from '@supabase/supabase-js';


import { normalizeSupabaseUser } from '../src/lib/supabase-auth';


/**
 * 登录身份归一化（教师端可识别"谁是谁"）测试：
 * - 平台代理超星 OAuth（supabase-auth 技能契约）：姓名/超星号随 user_metadata（realname/cxid）
 *   首建落库——normalizeSupabaseUser 必须读取并做空值兜底，否则 displayName 恒为"用户"、
 *   教师学情统计无法识别学生；
 * - 本地超星身份（app_metadata.chaoxing.*，应用自带 OAuth 路径）双链兼容、优先级不变；
 * - 头像由超星号构造（photo.chaoxing.com 公网 URL，无需接口）；
 * - 手机号/工号不可得（超星 OAuth 与平台业务代理均不下发），学号列以超星号兜底。
 */
function fakeUser(overrides: { metadata?: Record<string, unknown>; appMetadata?: Record<string, unknown> }): User {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    aud: 'authenticated',
    created_at: '2026-10-14T00:00:00Z',
    app_metadata: overrides.appMetadata ?? {},
    user_metadata: overrides.metadata ?? {},
  } as unknown as User;
}


test('平台代理超星 OAuth：realname/cxid 落地后姓名、学号、头像、超星号齐备', () => {
  const user = normalizeSupabaseUser(fakeUser({ metadata: { realname: '张小明', cxid: '2026123456' } }));
  assert.equal(user.role, 'student');
  assert.equal(user.displayName, '张小明');
  assert.equal(user.studentNo, '2026123456');
  assert.equal(user.chaoxingUid, '2026123456');
  assert.equal(user.avatarUrl, 'https://photo.chaoxing.com/p/2026123456_80');
});


test('平台代理超星 OAuth：realname 缺失时回退展示超星号（技能约定空值兜底）', () => {
  const user = normalizeSupabaseUser(fakeUser({ metadata: { cxid: '88776655' } }));
  assert.equal(user.displayName, '超星用户 88776655');
  assert.equal(user.studentNo, '88776655');
  assert.equal(user.avatarUrl, 'https://photo.chaoxing.com/p/88776655_80');
});


test('本地超星身份（app_metadata.chaoxing）优先级保持：full_name > chaoxing.displayName > realname', () => {
  const local = normalizeSupabaseUser(fakeUser({
    metadata: { full_name: '李老师' },
    appMetadata: { chaoxing: { uid: '10001', displayName: '超星显示名', studentNo: 'T2026001', fid: '1385' } },
  }));
  assert.equal(local.displayName, '李老师');
  assert.equal(local.studentNo, 'T2026001');
  assert.equal(local.chaoxingUid, '10001');


  const noFullName = normalizeSupabaseUser(fakeUser({
    appMetadata: { chaoxing: { uid: '10001', displayName: '超星显示名', studentNo: 'T2026001' } },
  }));
  assert.equal(noFullName.displayName, '超星显示名');


  const onlyRealname = normalizeSupabaseUser(fakeUser({
    metadata: { realname: '王同学' },
    appMetadata: { chaoxing: { studentNo: 'S001' } },
  }));
  assert.equal(onlyRealname.displayName, '王同学');
});


test('头像兜底链：avatar_url > chaoxing.avatar > 超星号构造；无任何来源为 null', () => {
  const withUrl = normalizeSupabaseUser(fakeUser({ metadata: { avatar_url: 'https://example.com/a.png', cxid: '1' } }));
  assert.equal(withUrl.avatarUrl, 'https://example.com/a.png');


  const withChaoxingAvatar = normalizeSupabaseUser(fakeUser({
    appMetadata: { chaoxing: { uid: '2', avatar: 'https://example.com/b.png' } },
  }));
  assert.equal(withChaoxingAvatar.avatarUrl, 'https://example.com/b.png');


  const none = normalizeSupabaseUser(fakeUser({}));
  assert.equal(none.avatarUrl, null);
});


test('无身份邮箱账号：默认姓名"用户"、无学号、无超星号（不触发 profiles 同步的边界）', () => {
  const user = normalizeSupabaseUser(fakeUser({}));
  assert.equal(user.displayName, '用户');
  assert.equal(user.studentNo, null);
  assert.equal(user.chaoxingUid, null);
  assert.equal(user.role, 'student');
});


test('教师判定不受影响：app_metadata.app.role=teacher 仍为教师', () => {
  const user = normalizeSupabaseUser(fakeUser({
    metadata: { realname: '陈老师', cxid: '90001' },
    appMetadata: { app: { role: 'teacher' } },
  }));
  assert.equal(user.role, 'teacher');
  assert.equal(user.displayName, '陈老师');
  assert.equal(user.studentNo, '90001');
});
