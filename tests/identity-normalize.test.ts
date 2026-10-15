import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from '@supabase/supabase-js';

import { normalizeSupabaseUser } from '../src/lib/supabase-auth';

/**
 * 登录身份归一化（教师端可识别"谁是谁"）测试：
 * - 双链身份语义：
 *   - 服务端身份（app_metadata.chaoxing.*，应用自有超星 OAuth 服务端写入）——不可由用户改写，展示优先；
 *   - 用户资料（user_metadata：平台代理超星 OAuth 首建落地的 realname/cxid，及 full_name/avatar_url）
 *     ——用户可自行修改，仅作展示兜底，nameSource/avatarSource 标注为 'user'，不作可信身份依据。
 * - 字段语义：cxid 是超星号（chaoxingUid），不是学号/工号——studentNo 只能来自服务端 chaoxing.studentNo，
 *   缺失时为 null（UI 显示"学号未提供"），禁止以 cxid 假填。
 * - 头像可由超星号构造（photo.chaoxing.com 公网 URL）；手机号超星不下发，不存在相关字段。
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

test('平台代理超星 OAuth：realname/cxid 落地后姓名、超星号、头像齐备，学号未提供不以 cxid 假填', () => {
  const user = normalizeSupabaseUser(fakeUser({ metadata: { realname: '张小明', cxid: '2026123456' } }));
  assert.equal(user.role, 'student');
  assert.equal(user.displayName, '张小明');
  assert.equal(user.nameSource, 'user');
  assert.equal(user.studentNo, null);
  assert.equal(user.chaoxingUid, '2026123456');
  assert.equal(user.avatarUrl, 'https://photo.chaoxing.com/p/2026123456_80');
  assert.equal(user.avatarSource, 'user');
});

test('平台代理超星 OAuth：realname 缺失时回退展示超星号（用户提供来源标注）', () => {
  const user = normalizeSupabaseUser(fakeUser({ metadata: { cxid: '88776655' } }));
  assert.equal(user.displayName, '超星用户 88776655');
  assert.equal(user.nameSource, 'user');
  assert.equal(user.studentNo, null);
  assert.equal(user.avatarUrl, 'https://photo.chaoxing.com/p/88776655_80');
});

test('服务端身份优先于用户资料：chaoxing.displayName > full_name > realname；学号仅取服务端 studentNo', () => {
  const serverFirst = normalizeSupabaseUser(fakeUser({
    metadata: { full_name: '李老师', realname: '李某某' },
    appMetadata: { chaoxing: { uid: '10001', displayName: '超星显示名', studentNo: 'T2026001', fid: '1385' } },
  }));
  assert.equal(serverFirst.displayName, '超星显示名');
  assert.equal(serverFirst.nameSource, 'server');
  assert.equal(serverFirst.studentNo, 'T2026001');
  assert.equal(serverFirst.chaoxingUid, '10001');

  const noServerName = normalizeSupabaseUser(fakeUser({
    metadata: { full_name: '李老师' },
    appMetadata: { chaoxing: { uid: '10001', studentNo: 'T2026001' } },
  }));
  assert.equal(noServerName.displayName, '李老师');
  assert.equal(noServerName.nameSource, 'user');
  assert.equal(noServerName.studentNo, 'T2026001');

  const onlyRealname = normalizeSupabaseUser(fakeUser({
    metadata: { realname: '王同学' },
    appMetadata: { chaoxing: { studentNo: 'S001' } },
  }));
  assert.equal(onlyRealname.displayName, '王同学');
  assert.equal(onlyRealname.nameSource, 'user');
});

test('头像兜底链：chaoxing.avatar（服务端） > avatar_url（用户） > 超星号构造；无任何来源为 null', () => {
  const serverAvatar = normalizeSupabaseUser(fakeUser({
    metadata: { avatar_url: 'https://example.com/user.png', cxid: '1' },
    appMetadata: { chaoxing: { uid: '9', avatar: 'https://example.com/server.png' } },
  }));
  assert.equal(serverAvatar.avatarUrl, 'https://example.com/server.png');
  assert.equal(serverAvatar.avatarSource, 'server');

  const withUrl = normalizeSupabaseUser(fakeUser({ metadata: { avatar_url: 'https://example.com/a.png', cxid: '1' } }));
  assert.equal(withUrl.avatarUrl, 'https://example.com/a.png');
  assert.equal(withUrl.avatarSource, 'user');

  const constructed = normalizeSupabaseUser(fakeUser({ metadata: { cxid: '2026123456' } }));
  assert.equal(constructed.avatarUrl, 'https://photo.chaoxing.com/p/2026123456_80');
  assert.equal(constructed.avatarSource, 'user');

  const none = normalizeSupabaseUser(fakeUser({}));
  assert.equal(none.avatarUrl, null);
  assert.equal(none.avatarSource, 'none');
});

test('无身份邮箱账号：默认姓名"用户"（none 来源）、无学号、无超星号', () => {
  const user = normalizeSupabaseUser(fakeUser({}));
  assert.equal(user.displayName, '用户');
  assert.equal(user.nameSource, 'none');
  assert.equal(user.studentNo, null);
  assert.equal(user.chaoxingUid, null);
  assert.equal(user.role, 'student');
});

test('教师判定不受影响：app_metadata.app.role=teacher 仍为教师；学号仍不以 cxid 假填', () => {
  const user = normalizeSupabaseUser(fakeUser({
    metadata: { realname: '陈老师', cxid: '90001' },
    appMetadata: { app: { role: 'teacher' } },
  }));
  assert.equal(user.role, 'teacher');
  assert.equal(user.displayName, '陈老师');
  assert.equal(user.studentNo, null);
  assert.equal(user.chaoxingUid, '90001');
});
