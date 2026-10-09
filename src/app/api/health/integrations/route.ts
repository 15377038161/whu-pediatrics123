import { NextRequest } from 'next/server';
import { readdirSync } from 'node:fs';
import { ok } from '@/lib/api-result';
import { chaoxingFormConfigured } from '@/lib/chaoxing-sync';
import { isChaoxingConfigured } from '@/lib/chaoxing-client';
import { describeAIConfig } from '@/lib/coze-ai';
import { isPreviewEnabled } from '@/lib/preview-auth';
import { isKnowledgeConfigured } from '@/lib/case-snapshot';
import { getSupabaseCredentialsClient, isDatabaseConfigured } from '@/lib/supabase-client';

async function probeDatabase(timeoutMs = 4000): Promise<'connected' | 'configured_unreachable'> {
  try {
    // 探测公开只读表（cases 已发布行），不依赖任何特权身份
    const client = getSupabaseCredentialsClient();
    const probe = client.from('cases').select('id').limit(1);
    await Promise.race([
      probe,
      new Promise((_, reject) => setTimeout(() => reject(new Error('database probe timeout')), timeoutMs)),
    ]);
    return 'connected';
  } catch {
    return 'configured_unreachable';
  }
}

/**
 * 病例知识库装载健康维度（2026-10-13 第四轮最小化改造）：
 * - localFiles：本地 knowledge/teaching-cases JSON 是否存在（'present' | 'missing'，不再返回文件计数）；
 * - recall：知识库召回配置状态（平台注入凭据是否存在）；
 * - persisted：DB 持久化快照装载状态，仅最小枚举（新 RPC case_knowledge_status）：
 *     'ready'        双通道装载完成（facts>0 且 answers>0）
 *     'partial'      教学事实已装载、教师对照答案缺失（facts>0 且 answers=0）
 *     'empty'        未装载（facts 0 行）
 *     'unknown'      RPC 不可用（未迁移/网络异常），如实显示未知
 * 公开端点零业务计数、零病例 ID、零版本内容、零内部路径：
 * 原 persistedFactsVersions/persistedAnswerVersions/localCaseFiles 计数与
 * bound_teacher_sessions 会话数属业务运营信息，已从公开响应移除（教师侧详细计数
 * 由收紧后的 case_knowledge_health_counts RPC 仅教师可查）。
 */
async function probeCaseKnowledge(): Promise<{
  localFiles: 'present' | 'missing';
  recall: 'configured' | 'missing_credentials';
  persisted: 'ready' | 'partial' | 'empty' | 'unknown';
}> {
  let localPresent = false;
  try {
    localPresent = readdirSync(`${process.env.PEDIATRICS_KNOWLEDGE_ROOT || 'knowledge'}/teaching-cases`)
      .some((name) => name.endsWith('.json'));
  } catch {
    localPresent = false;
  }
  let persisted: 'ready' | 'partial' | 'empty' | 'unknown' = 'unknown';
  if (isDatabaseConfigured()) {
    try {
      const client = getSupabaseCredentialsClient();
      const { data, error } = await client.rpc('case_knowledge_status');
      if (!error && typeof data === 'string') {
        persisted = data === 'ready' || data === 'partial' || data === 'empty' ? data : 'unknown';
      }
    } catch {
      // RPC 不可用（未迁移/网络）：保持 unknown，健康状态如实显示
    }
  }
  return {
    localFiles: localPresent ? 'present' : 'missing',
    recall: isKnowledgeConfigured() ? 'configured' : 'missing_credentials',
    persisted,
  };
}

export async function GET(_request: NextRequest) {
  const database = isDatabaseConfigured() ? await probeDatabase() : 'waiting_for_coze_database';
  const authentication = isChaoxingConfigured();
  const ai = describeAIConfig();
  const caseKnowledge = await probeCaseKnowledge();
  return ok({
    app: 'ready',
    database,
    caseKnowledge,
    model: process.env.ENABLE_AI_FIXTURE === 'true' ? 'fixture_with_deterministic_fallback' : 'coze_runtime',
    ai: { ...ai, status: ai.apiKeySource === 'missing' ? 'waiting_for_credentials' : 'configured' },
    chaoxingAuth: authentication ? 'configured_awaiting_live_verification' : 'waiting_for_authorization',
    chaoxingForm: chaoxingFormConfigured() ? 'configured_awaiting_live_verification' : 'waiting_for_write_contract',
    preview: isPreviewEnabled() ? ((process.env.CODER_PROJECTS_ENV || process.env.COZE_PROJECT_ENV) === 'PROD' ? 'enabled_production' : 'enabled_non_production') : 'disabled',
  });
}
