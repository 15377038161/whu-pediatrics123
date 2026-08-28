import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { classifyAIError, describeAIConfig, invokeCozeAI } from '@/lib/coze-ai';
import { renderRoleReply } from '@/lib/role-agent';

process.env.ENABLE_AI_FIXTURE = 'false';
process.env.COZE_PROJECT_ENV = process.env.COZE_PROJECT_ENV || 'PROD';

const LIVE = process.env.AI_LIVE_TEST === '1';
const skipReason = LIVE ? false : 'set AI_LIVE_TEST=1 to run live Coze AI integration tests';

const MODEL_NAME = 'doubao-seed-2-0-lite-260215';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function summarize(label: string, durations: number[], failures: string[]) {
  const sorted = [...durations].sort((a, b) => a - b);
  const summary = {
    label,
    total: durations.length + failures.length,
    success: durations.length,
    failures: failures.length,
    failureKinds: failures.reduce<Record<string, number>>((acc, kind) => { acc[kind] = (acc[kind] ?? 0) + 1; return acc; }, {}),
    successRate: durations.length + failures.length === 0 ? 1 : Number((durations.length / (durations.length + failures.length)).toFixed(3)),
    latencyMs: {
      min: sorted[0] ?? 0,
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      max: sorted.at(-1) ?? 0,
      avg: sorted.length === 0 ? 0 : Math.round(sorted.reduce((sum, item) => sum + item, 0) / sorted.length),
    },
  };
  console.log(`[AI-LIVE-SUMMARY] ${JSON.stringify(summary)}`);
  return summary;
}

test('live: 接入配置可描述且凭据来源明确', { skip: skipReason }, () => {
  const summary = describeAIConfig();
  assert.equal(summary.provider, 'coze_native');
  assert.notEqual(summary.apiKeySource, 'missing', 'AI API key 未注入，无法执行真实集成测试');
  assert.ok(summary.baseUrl.startsWith('https://'), '基础请求域名必须是 HTTPS');
  assert.ok(summary.timeoutMs > 0 && summary.maxAttempts >= 1);
});

test('live: 功能测试 - 真实问诊应答生成连续 8 次调用', { skip: skipReason }, async () => {
  const durations: number[] = [];
  const failures: string[] = [];
  let parsedReplies = 0;
  for (let round = 0; round < 8; round += 1) {
    const result = await renderRoleReply({
      childAge: '3岁',
      childSex: '男',
      question: round % 2 === 0 ? '什么时候开始发热咳嗽的？' : '孩子晚上睡得安稳吗？',
      childFact: round % 2 === 0 ? '三天前开始发热，最高39度，伴阵发性咳嗽' : '夜间咳嗽增多，睡不踏实',
      parentFact: round % 2 === 0 ? '家长补充：发热在三天前出现，自行测体温最高39摄氏度' : '家长补充：近三天夜里咳醒两三次',
      preferredActor: 'mixed',
      parentPaused: false,
      childComforted: false,
    });
    if (result.runtime.execution === 'model' && result.reply) parsedReplies += 1;
    if (result.runtime.execution === 'model_fallback') {
      failures.push(result.runtime.errorKind ?? 'unknown');
    } else {
      durations.push(result.runtime.durationMs);
    }
  }
  const summary = summarize('functional-role-reply', durations, failures);
  assert.ok(summary.successRate >= 0.875, `功能成功率 ${summary.successRate} 低于验收线 87.5%`);
  assert.ok(parsedReplies >= 6, `结构化解析成功 ${parsedReplies}/8，低于验收线 6`);
});

test('live: 功能测试 - 完整业务链路（创建会话→问诊轮次）', { skip: skipReason }, async () => {
  const session = createInitialSession('live-student', 'guided');
  const startedAt = Date.now();
  const result = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '什么时候开始发热咳嗽的？' } }, 'live-event-1');
  assert.ok(result.newMessages.length > 0, '问诊轮次必须产生应答消息');
  assert.ok(['model', 'model_fallback'].includes(result.runtime?.execution ?? ''), '运行时摘要必须反映模型执行路径');
  console.log(`[AI-LIVE-SUMMARY] ${JSON.stringify({ label: 'business-turn', execution: result.runtime?.execution, attempts: result.runtime?.attempts, durationMs: Date.now() - startedAt })}`);
});

test('live: 压力测试 - 24 次调用并发 8', { skip: skipReason }, async (context) => {
  const total = 24;
  const concurrency = 8;
  const durations: number[] = [];
  const failures: string[] = [];
  const startedAt = Date.now();
  for (let offset = 0; offset < total; offset += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, total - offset) }, (_, index) => {
      const taskId = offset + index;
      return (async () => {
        const attemptStart = Date.now();
        try {
          const result = await invokeCozeAI({
            messages: [
              { role: 'system', content: '你是儿科问诊助手，只输出两个字。' },
              { role: 'user', content: `第${taskId + 1}次连通性检查，只回复“正常”两个字。` },
            ],
            llmConfig: { model: MODEL_NAME, temperature: 0.2, thinking: 'disabled', caching: 'disabled' },
          });
          assert.equal(typeof result.content, 'string');
          durations.push(Date.now() - attemptStart);
        } catch (error) {
          failures.push(classifyAIError(error).kind);
        }
      })();
    });
    await Promise.all(batch);
  }
  const wallMs = Date.now() - startedAt;
  const summary = summarize(`stress-c${concurrency}-n${total}`, durations, failures);
  console.log(`[AI-LIVE-SUMMARY] ${JSON.stringify({ label: 'stress-wall-clock', wallMs, throughputRps: Number((total / (wallMs / 1000)).toFixed(2)) })}`);
  assert.ok(summary.successRate >= 0.95, `压力成功率 ${summary.successRate} 低于验收线 95%`);
  assert.ok(summary.latencyMs.p95 <= 30_000, `P95 延迟 ${summary.latencyMs.p95}ms 超过 30s 上限`);
  context.diagnostic(`wall=${wallMs}ms p50=${summary.latencyMs.p50}ms p95=${summary.latencyMs.p95}ms`);
});
