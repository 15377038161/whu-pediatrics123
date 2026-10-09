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
 * 病例知识库装载健康维度（仅非敏感计数，替代"静默资料不足"）：
 * - localCaseFiles：本地 knowledge/teaching-cases JSON 文件数（缺 53 源时运维可明确判断）；
 * - recall：知识库召回配置状态（平台注入凭据是否存在）；
 * - persistedFactsVersions / persistedAnswerVersions：DB 持久化快照版本计数
 *   （case_knowledge_health_counts RPC，SECURITY DEFINER 仅返回聚合计数，无病例内容）。
 * 不输出任何病例 ID、患者事实或版本内容。
 */
async function probeCaseKnowledge(): Promise<{
  localCaseFiles: number;
  recall: 'configured' | 'missing_credentials';
  persistedFactsVersions: number | null;
  persistedAnswerVersions: number | null;
}> {
  let localCaseFiles = 0;
  try {
    localCaseFiles = readdirSync(`${process.env.PEDIATRICS_KNOWLEDGE_ROOT || 'knowledge'}/teaching-cases`)
      .filter((name) => name.endsWith('.json')).length;
  } catch {
    localCaseFiles = 0;
  }
  let persistedFactsVersions: number | null = null;
  let persistedAnswerVersions: number | null = null;
  if (isDatabaseConfigured()) {
    try {
      const client = getSupabaseCredentialsClient();
      const { data, error } = await client.rpc('case_knowledge_health_counts');
      if (!error && data && typeof data === 'object') {
        persistedFactsVersions = Number((data as { persisted_facts_versions?: number }).persisted_facts_versions ?? 0);
        persistedAnswerVersions = Number((data as { persisted_answer_versions?: number }).persisted_answer_versions ?? 0);
      }
    } catch {
      // RPC 不可用（未迁移/网络）：保持 null，健康状态如实显示未知
    }
  }
  return {
    localCaseFiles,
    recall: isKnowledgeConfigured() ? 'configured' : 'missing_credentials',
    persistedFactsVersions,
    persistedAnswerVersions,
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
