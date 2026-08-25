import { LLMClient } from 'coze-coding-dev-sdk';
import { z } from 'zod';
import type { AgentRuntimeSummary } from '@/domain/agent';

const MODEL_NAME = 'doubao-seed-2-0-lite-260215';

const roleReplySchema = z.object({
  child: z.string().max(180).optional(),
  parent: z.string().max(260).optional(),
  childEmotion: z.enum(['nervous', 'calm', 'low', 'resistant', 'anxious', 'neutral']),
});

export interface RoleReplyInput {
  childAge: string;
  childSex: string;
  question: string;
  childFact: string;
  parentFact: string;
  preferredActor: 'child' | 'parent' | 'mixed';
  parentPaused: boolean;
  childComforted: boolean;
}

function shouldUseModel(): boolean {
  return process.env.ENABLE_AI_FIXTURE !== 'true' && Boolean(process.env.COZE_PROJECT_ENV);
}

export async function renderRoleReply(input: RoleReplyInput): Promise<{ reply: z.infer<typeof roleReplySchema> | null; runtime: AgentRuntimeSummary }> {
  const startedAt = Date.now();
  if (!shouldUseModel()) return { reply: null, runtime: { execution: 'deterministic', model: null, durationMs: Date.now() - startedAt } };
  try {
    const client = new LLMClient();
    const response = await client.invoke([
      {
        role: 'system',
        content: [
          `你是儿科标准化病人模拟智能体。只能把给定事实改写为符合${input.childAge}${input.childSex}童或陪诊家长的自然中文，不得补充任何新病史、检查或诊断。`,
          '患儿表达应短、口语化且医学认知有限；家长可以补充但不能泄露未给出的事实。',
          '只输出JSON：{"child":"可选","parent":"可选","childEmotion":"nervous|calm|low|resistant|anxious|neutral"}。',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify(input) },
    ], {
      model: MODEL_NAME,
      temperature: 0.35,
      thinking: 'disabled',
      caching: 'disabled',
    });
    const raw = response.content.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    return {
      reply: roleReplySchema.parse(JSON.parse(raw)),
      runtime: { execution: 'model', model: MODEL_NAME, durationMs: Date.now() - startedAt },
    };
  } catch {
    console.warn('[role-agent] structured reply fallback');
    return {
      reply: null,
      runtime: { execution: 'model_fallback', model: MODEL_NAME, durationMs: Date.now() - startedAt },
    };
  }
}
