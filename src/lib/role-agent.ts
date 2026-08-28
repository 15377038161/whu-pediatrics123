import { z } from 'zod';
import type { AgentRuntimeSummary } from '@/domain/agent';
import { AIGatewayError, classifyAIError, invokeCozeAI } from '@/lib/coze-ai';

const MODEL_NAME = 'doubao-seed-2-0-lite-260215';

const roleReplySchema = z.object({
  child: z.string().max(180).optional(),
  parent: z.string().max(260).optional(),
  childEmotion: z.enum(['nervous', 'calm', 'low', 'resistant', 'anxious', 'neutral']),
});

export type RoleReply = z.infer<typeof roleReplySchema>;

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

function extractJsonCandidate(text: string): string | null {
  const stripped = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
  if (stripped.startsWith('{')) return stripped;
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

function parseRoleReply(content: string): RoleReply | null {
  const candidate = extractJsonCandidate(content);
  if (!candidate) return null;
  try {
    const parsed = roleReplySchema.safeParse(JSON.parse(candidate));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function renderRoleReply(input: RoleReplyInput, forwardHeaders?: Record<string, string>): Promise<{ reply: RoleReply | null; runtime: AgentRuntimeSummary }> {
  const startedAt = Date.now();
  if (!shouldUseModel()) return { reply: null, runtime: { execution: 'deterministic', model: null, durationMs: Date.now() - startedAt } };
  try {
    const { content, attempts } = await invokeCozeAI({
      messages: [
        {
          role: 'system',
          content: [
            `你是儿科标准化病人模拟智能体。只能把给定事实改写为符合${input.childAge}${input.childSex}童或陪诊家长的自然中文，不得补充任何新病史、检查或诊断。`,
            '患儿表达应短、口语化且医学认知有限；家长可以补充但不能泄露未给出的事实。',
            '只输出JSON：{"child":"可选","parent":"可选","childEmotion":"nervous|calm|low|resistant|anxious|neutral"}。',
          ].join('\n'),
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
      llmConfig: { model: MODEL_NAME, temperature: 0.35, thinking: 'disabled', caching: 'disabled' },
      forwardHeaders,
    });
    const reply = parseRoleReply(content);
    if (!reply) {
      console.warn('[role-agent] structured reply fallback');
      return { reply: null, runtime: { execution: 'model_fallback', model: MODEL_NAME, durationMs: Date.now() - startedAt, attempts, errorKind: 'unparsable_response' } };
    }
    return { reply, runtime: { execution: 'model', model: MODEL_NAME, durationMs: Date.now() - startedAt, attempts } };
  } catch (error) {
    const info = classifyAIError(error);
    const attempts = error instanceof AIGatewayError ? error.attempts : 1;
    console.warn(`[role-agent] structured reply fallback (${info.kind}${info.statusCode ? ` ${info.statusCode}` : ''})`);
    return { reply: null, runtime: { execution: 'model_fallback', model: MODEL_NAME, durationMs: Date.now() - startedAt, attempts, errorKind: info.kind } };
  }
}
