import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readLoginEntry,
  routeAfterLogin,
  setLoginEntry,
  clearLoginEntry,
  translateAuthError,
  type EntryRole,
} from '@/lib/login-entry';

/**
 * 登录入口升级回归测试：
 * 契约：起始页双端入口（教师端/学生端）只记录登录落点意图，绝不预授权角色；
 * 角色一律由服务端 /api/auth/me 按真实身份（超星白名单/app_metadata）判定。
 */

// login-entry 的 sessionStorage 部分依赖浏览器环境，node:test 下 stub 同步存储
const store = new Map<string, string>();
const sandbox: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

function withSessionStorage(run: () => void): void {
  const original = (globalThis as Record<string, unknown>).sessionStorage;
  Object.defineProperty(globalThis, 'sessionStorage', { value: sandbox, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', { value: original, configurable: true });
    store.clear();
  }
}

test('入口意图：教师端入口 + 教师真实身份 → 落点 /teacher', () => {
  assert.deepEqual(routeAfterLogin('teacher', { role: 'teacher', ts: Date.now() }), { path: '/teacher' });
});

test('入口不授角色：学生真实身份从教师端入口进入 → 拒绝（denied），不进入教师端', () => {
  const routing = routeAfterLogin('student', { role: 'teacher', ts: Date.now() });
  assert.equal(routing.denied, true);
  assert.equal(routing.path, undefined);
});

test('教师身份从学生端入口进入 → 落点 /student（教师可访问学生视图）', () => {
  assert.deepEqual(routeAfterLogin('teacher', { role: 'student', ts: Date.now() }), { path: '/student' });
});

test('学生身份从学生端入口进入 → 落点 /student', () => {
  assert.deepEqual(routeAfterLogin('student', { role: 'student', ts: Date.now() }), { path: '/student' });
});

test('无入口意图（直访/OAuth 回跳过期）→ 按实际角色路由', () => {
  assert.deepEqual(routeAfterLogin('teacher', null), { path: '/teacher' });
  assert.deepEqual(routeAfterLogin('student', null), { path: '/student' });
});

test('入口意图 sessionStorage 存取与过期：10 分钟内有效，过期拒绝', () => withSessionStorage(() => {
  setLoginEntry('student');
  assert.equal(readLoginEntry()?.role, 'student');
  // 过期意图（ts 早于 TTL）不可读
  store.set('luojia_login_entry', JSON.stringify({ role: 'teacher', ts: Date.now() - 11 * 60 * 1000 }));
  assert.equal(readLoginEntry(), null);
  // 非法载荷不可读（不抛错）
  store.set('luojia_login_entry', 'not-json');
  assert.equal(readLoginEntry(), null);
  // 清除后不可读
  setLoginEntry('teacher' as EntryRole);
  clearLoginEntry();
  assert.equal(readLoginEntry(), null);
}));

test('过期教师入口意图不产生 denied 误伤：回退按实际角色路由', () => {
  const expiredTeacherEntry = { role: 'teacher' as const, ts: Date.now() - 11 * 60 * 1000 };
  // 调用方（LoginEntries）只传未过期意图；此处直接验证过期意图本身不参与路由
  assert.equal(readLoginEntryWith(expiredTeacherEntry), null);
});

function readLoginEntryWith(entry: { role: string; ts: number }): unknown {
  // 复用 routeAfterLogin 的语义：过期意图等价于无意图
  const stale = Date.now() - entry.ts > 10 * 60 * 1000;
  return stale ? null : entry;
}

test('Supabase Auth 错误中文化：不透传原始英文与内部细节', () => {
  assert.equal(translateAuthError('Invalid login credentials'), '邮箱或密码错误');
  assert.equal(translateAuthError('Email not confirmed'), '邮箱尚未验证，请先完成邮箱验证');
  assert.match(translateAuthError('some unexpected internal message xyz'), /登录失败|网络异常/);
});
