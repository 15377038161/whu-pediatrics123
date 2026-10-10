import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoleReplyInput } from '@/lib/role-agent';
import { renderRoleReply } from '@/lib/role-agent';
import { hasAICredentials } from '@/lib/coze-ai';

/** shouldUseModel 对齐验证：role-agent 的模型路径判定复用 coze-ai 统一凭据链
 *  （显式 COZE_AI_* 覆盖 > 平台注入 CODER_CODING_* > 旧 COZE_WORKLOAD_*），
 *  旧实现检查 COZE_PROJECT_ENV/COZE_AI_API_KEY 漏检平台注入的 CODER_CODING_*，
 *  导致沙箱（实测注入 CODER_CODING_API_KEY）有凭据时仍恒走 deterministic。
 *  fixture 关闭与 model_fallback 安全降级保持不变。 */

const CHAIN_VARS = ['COZE_AI_API_KEY', 'CODER_CODING_API_KEY', 'CODER_CODING_MODEL_API_KEY', 'COZE_WORKLOAD_IDENTITY_API_KEY'] as const;

function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> | void {
  const saved = new Map<string, string | undefined>();
  for (const key of [...CHAIN_VARS, 'ENABLE_AI_FIXTURE'] as const) saved.set(key, process.env[key]);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    return Promise.resolve(fn()).finally(restore);
  } finally {
    // 同步异常时立即还原（fn 返回 Promise 时由 finally 还原）
  }
}

const minimalInput = {
  childAge: '5岁',
  childSex: '男',
  question: '小朋友哪里不舒服？',
  childFact: '肚子疼了两天',
  parentFact: '孩子这两天说肚子疼',
  preferredActor: 'child',
  parentPaused: false,
  childComforted: false,
} satisfies RoleReplyInput;

test('hasAICredentials：仅平台注入 CODER_CODING_API_KEY 即为 true（对齐核心场景）', () => {
  withEnv({ COZE_AI_API_KEY: undefined, CODER_CODING_API_KEY: 'platform-key', CODER_CODING_MODEL_API_KEY: undefined, COZE_WORKLOAD_IDENTITY_API_KEY: undefined }, () => {
    assert.equal(hasAICredentials(), true, '平台注入 CODER_CODING_API_KEY 应判定有凭据');
  });
});

test('hasAICredentials：CODER_CODING_MODEL_API_KEY（模型专用覆盖）同样命中', () => {
  withEnv({ COZE_AI_API_KEY: undefined, CODER_CODING_API_KEY: undefined, CODER_CODING_MODEL_API_KEY: 'model-key', COZE_WORKLOAD_IDENTITY_API_KEY: undefined }, () => {
    assert.equal(hasAICredentials(), true);
  });
});

test('hasAICredentials：凭据链全空为 false', () => {
  withEnv({ COZE_AI_API_KEY: undefined, CODER_CODING_API_KEY: undefined, CODER_CODING_MODEL_API_KEY: undefined, COZE_WORKLOAD_IDENTITY_API_KEY: undefined }, () => {
    assert.equal(hasAICredentials(), false);
  });
});

test('hasAICredentials：显式 COZE_AI_API_KEY 覆盖命中（env_override 优先链保留）', () => {
  withEnv({ COZE_AI_API_KEY: 'explicit-key', CODER_CODING_API_KEY: undefined, CODER_CODING_MODEL_API_KEY: undefined, COZE_WORKLOAD_IDENTITY_API_KEY: undefined }, () => {
    assert.equal(hasAICredentials(), true);
  });
});

test('renderRoleReply：fixture 开启 → 恒 deterministic，不调模型', async () => {
  await withEnv({ ENABLE_AI_FIXTURE: 'true', CODER_CODING_API_KEY: 'platform-key' }, async () => {
    const { reply, runtime } = await renderRoleReply(minimalInput);
    assert.equal(reply, null);
    assert.equal(runtime.execution, 'deterministic');
  });
});

test('renderRoleReply：fixture 关闭但凭据缺失 → deterministic（不发起必败请求）', async () => {
  await withEnv({
    ENABLE_AI_FIXTURE: 'false',
    COZE_AI_API_KEY: undefined,
    CODER_CODING_API_KEY: undefined,
    CODER_CODING_MODEL_API_KEY: undefined,
    COZE_WORKLOAD_IDENTITY_API_KEY: undefined,
  }, async () => {
    const { runtime } = await renderRoleReply(minimalInput);
    assert.equal(runtime.execution, 'deterministic', '无凭据时不得走模型路径');
  });
});

test('renderRoleReply：fixture 关闭且有平台凭据 → 不再恒 deterministic（尝试模型，失败安全降级）', async () => {
  await withEnv({ ENABLE_AI_FIXTURE: 'false', CODER_CODING_API_KEY: 'platform-key' }, async () => {
    const { runtime } = await renderRoleReply(minimalInput);
    assert.notEqual(runtime.execution, 'deterministic', '有平台凭据时必须尝试模型路径（修复前恒 deterministic）');
    assert.ok(runtime.execution === 'model' || runtime.execution === 'model_fallback', '结果只能是 model 或 model_fallback（安全降级保留）');
  });
});
