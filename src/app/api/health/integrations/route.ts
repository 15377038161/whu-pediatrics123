import { NextRequest } from 'next/server';
import { ok } from '@/lib/api-result';
import { chaoxingFormConfigured } from '@/lib/chaoxing-sync';
import { isChaoxingConfigured } from '@/lib/chaoxing-client';
import { describeAIConfig } from '@/lib/coze-ai';
import { isPreviewEnabled } from '@/lib/preview-auth';
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

export async function GET(_request: NextRequest) {
  const database = isDatabaseConfigured() ? await probeDatabase() : 'waiting_for_coze_database';
  const authentication = isChaoxingConfigured();
  const ai = describeAIConfig();
  return ok({
    app: 'ready',
    database,
    model: process.env.ENABLE_AI_FIXTURE === 'true' ? 'fixture_with_deterministic_fallback' : 'coze_runtime',
    ai: { ...ai, status: ai.apiKeySource === 'missing' ? 'waiting_for_credentials' : 'configured' },
    chaoxingAuth: authentication ? 'configured_awaiting_live_verification' : 'waiting_for_authorization',
    chaoxingForm: chaoxingFormConfigured() ? 'configured_awaiting_live_verification' : 'waiting_for_write_contract',
    preview: isPreviewEnabled() ? ((process.env.CODER_PROJECTS_ENV || process.env.COZE_PROJECT_ENV) === 'PROD' ? 'enabled_production' : 'enabled_non_production') : 'disabled',
  });
}
