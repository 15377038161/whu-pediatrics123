import { test } from 'node:test';
import assert from 'node:assert/strict';

test('超星OAuth配置 - FID解析', async (t) => {
  await t.test('解析单个FID', () => {
    const result = parseInstitutions('1024');
    assert.deepEqual(result, [{ fid: '1024', name: '1024' }]);
  });

  await t.test('解析带名称的FID', () => {
    const result = parseInstitutions('1024:武汉大学');
    assert.deepEqual(result, [{ fid: '1024', name: '武汉大学' }]);
  });

  await t.test('解析多个FID', () => {
    const result = parseInstitutions('1024,1385');
    assert.deepEqual(result, [
      { fid: '1024', name: '1024' },
      { fid: '1385', name: '1385' }
    ]);
  });

  await t.test('解析多个带名称的FID', () => {
    const result = parseInstitutions('1024:武汉大学,1385:武汉大学医学院');
    assert.deepEqual(result, [
      { fid: '1024', name: '武汉大学' },
      { fid: '1385', name: '武汉大学医学院' }
    ]);
  });

  await t.test('处理混合格式', () => {
    const result = parseInstitutions('1024:武汉大学,1385');
    assert.deepEqual(result, [
      { fid: '1024', name: '武汉大学' },
      { fid: '1385', name: '1385' }
    ]);
  });

  await t.test('忽略空条目', () => {
    const result = parseInstitutions('1024,,1385');
    assert.deepEqual(result, [
      { fid: '1024', name: '1024' },
      { fid: '1385', name: '1385' }
    ]);
  });

  await t.test('去重FID', () => {
    const result = parseInstitutions('1024,1024:武汉大学');
    assert.deepEqual(result, [{ fid: '1024', name: '1024' }]);
  });
});

test('超星OAuth配置 - 回调地址生成', async (t) => {
  await t.test('使用显式配置的CHAOXING_REDIRECT_URI', () => {
    const env = {
      CHAOXING_REDIRECT_URI: 'https://custom.domain.com/api/auth/callback/chaoxing',
      COZE_PROJECT_DOMAIN_DEFAULT: 'https://default.coze.site'
    };
    assert.equal(normalizeRedirectUri(env), 'https://custom.domain.com/api/auth/callback/chaoxing');
  });

  await t.test('从COZE_PROJECT_DOMAIN_DEFAULT生成（带https）', () => {
    const env = {
      COZE_PROJECT_DOMAIN_DEFAULT: 'https://my-app.coze.site'
    };
    assert.equal(normalizeRedirectUri(env), 'https://my-app.coze.site/api/auth/callback/chaoxing');
  });

  await t.test('从COZE_PROJECT_DOMAIN_DEFAULT生成（不带协议）', () => {
    const env = {
      COZE_PROJECT_DOMAIN_DEFAULT: 'my-app.coze.site'
    };
    assert.equal(normalizeRedirectUri(env), 'https://my-app.coze.site/api/auth/callback/chaoxing');
  });

  await t.test('两者都缺失时抛出错误', () => {
    assert.throws(
      () => normalizeRedirectUri({}),
      { message: /无法确定回调地址/ }
    );
  });
});

test('超星OAuth配置 - 教师权限逻辑', async (t) => {
  await t.test('UID在白名单且角色匹配时授予教师权限', () => {
    const identity = {
      uid: '12345678',
      role: [{ roleId: '101', roleName: '教师' }]
    };
    const env = { CHAOXING_TEACHER_UIDS: '12345678,87654321' };
    assert.equal(isTeacherAllowed(identity, env), true);
  });

  await t.test('UID不在白名单时拒绝教师权限', () => {
    const identity = {
      uid: '99999999',
      role: [{ roleId: '101', roleName: '教师' }]
    };
    const env = { CHAOXING_TEACHER_UIDS: '12345678,87654321' };
    assert.equal(isTeacherAllowed(identity, env), false);
  });

  await t.test('角色不匹配时拒绝教师权限', () => {
    const identity = {
      uid: '12345678',
      role: [{ roleId: '102', roleName: '学生' }]
    };
    const env = { CHAOXING_TEACHER_UIDS: '12345678' };
    assert.equal(isTeacherAllowed(identity, env), false);
  });

  await t.test('白名单为空时全部拒绝', () => {
    const identity = {
      uid: '12345678',
      role: [{ roleId: '101', roleName: '教师' }]
    };
    const env = { CHAOXING_TEACHER_UIDS: '' };
    assert.equal(isTeacherAllowed(identity, env), false);
  });

  await t.test('匹配多种教师角色名称', () => {
    const testCases = [
      { roleName: '教师', expected: true },
      { roleName: 'teacher', expected: true },
      { roleName: 'Teacher', expected: true },
      { roleName: '管理员', expected: true },
      { roleName: '学生', expected: false },
      { roleName: 'student', expected: false }
    ];

    for (const { roleName, expected } of testCases) {
      const identity = {
        uid: '12345678',
        role: [{ roleId: '101', roleName }]
      };
      const env = { CHAOXING_TEACHER_UIDS: '12345678' };
      assert.equal(isTeacherAllowed(identity, env), expected, `角色 "${roleName}" 应该${expected ? '通过' : '拒绝'}`);
    }
  });
});

test('超星OAuth配置 - 安全重定向路径验证', async (t) => {
  await t.test('接受有效的内部路径', () => {
    assert.equal(isSafeRedirectPath('/student'), true);
    assert.equal(isSafeRedirectPath('/teacher'), true);
    assert.equal(isSafeRedirectPath('/student?tab=history'), true);
  });

  await t.test('拒绝以//开头的路径', () => {
    assert.equal(isSafeRedirectPath('//evil.com'), false);
  });

  await t.test('拒绝外部URL', () => {
    assert.equal(isSafeRedirectPath('https://evil.com'), false);
    assert.equal(isSafeRedirectPath('http://evil.com'), false);
  });

  await t.test('拒绝非斜杠开头的路径', () => {
    assert.equal(isSafeRedirectPath('student'), false);
  });

  await t.test('处理null和undefined', () => {
    assert.equal(isSafeRedirectPath(null), false);
    assert.equal(isSafeRedirectPath(undefined), false);
  });
});

// 测试辅助函数
function parseInstitutions(raw: string): Array<{ fid: string; name: string }> {
  const values = new Map<string, { fid: string; name: string }>();
  for (const item of raw.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = item.indexOf(':');
    const fid = (separator < 0 ? item : item.slice(0, separator)).trim();
    const name = separator < 0 ? fid : item.slice(separator + 1).trim() || fid;
    if (fid && !values.has(fid)) values.set(fid, { fid, name });
  }
  return [...values.values()];
}

function normalizeRedirectUri(env: Record<string, string | undefined>): string {
  const explicit = env.CHAOXING_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const domain = env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (domain) {
    const base = domain.startsWith('http') ? domain : `https://${domain}`;
    return `${base}/api/auth/callback/chaoxing`;
  }

  throw new Error('无法确定回调地址：CHAOXING_REDIRECT_URI 和 COZE_PROJECT_DOMAIN_DEFAULT 都未配置');
}

function isTeacherAllowed(identity: { uid: string; role: Array<{ roleName: string }> }, env: Record<string, string | undefined>): boolean {
  const providerTeacher = identity.role.some((role) => /教师|teacher|管理员/i.test(role.roleName));
  const allowlist = new Set((env.CHAOXING_TEACHER_UIDS ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  return providerTeacher && allowlist.has(identity.uid);
}

function isSafeRedirectPath(value: string | null | undefined): boolean {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return false;
  try {
    const parsed = new URL(value, 'https://local.invalid');
    return parsed.origin === 'https://local.invalid';
  } catch {
    return false;
  }
}
