import { NextRequest } from 'next/server';
import { ok } from '@/lib/api-result';
import { chaoxingFormConfigured } from '@/lib/chaoxing-sync';
import { isChaoxingConfigured } from '@/lib/chaoxing-client';
import { describeAIConfig } from '@/lib/coze-ai';
import { isPreviewEnabled } from '@/lib/preview-auth';

export async function GET(_request: NextRequest) {
  const database = Boolean(process.env.COZE_SUPABASE_URL && process.env.COZE_SUPABASE_SERVICE_ROLE_KEY);
  const authentication = isChaoxingConfigured();
  const ai = describeAIConfig();
  return ok({
    app: 'ready',
    database: database ? 'configured' : 'waiting_for_coze_database',
    model: process.env.ENABLE_AI_FIXTURE === 'true' ? 'fixture_with_deterministic_fallback' : 'coze_runtime',
    ai: { ...ai, status: ai.apiKeySource === 'missing' ? 'waiting_for_credentials' : 'configured' },
    chaoxingAuth: authentication ? 'configured_awaiting_live_verification' : 'waiting_for_authorization',
    chaoxingForm: chaoxingFormConfigured() ? 'configured_awaiting_live_verification' : 'waiting_for_write_contract',
    preview: isPreviewEnabled() ? (process.env.COZE_PROJECT_ENV === 'PROD' ? 'enabled_production' : 'enabled_non_production') : 'disabled',
  });
}
