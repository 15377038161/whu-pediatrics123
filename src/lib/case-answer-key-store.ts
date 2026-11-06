import { isCaseAnswerKeyRecord, type CaseAnswerKeyRecord } from '@/domain/case-analysis';
import { getSupabaseServiceClient } from '@/lib/supabase-client';

export interface CaseAnswerKeyRow {
  case_id: string;
  version: string;
  status: CaseAnswerKeyRecord['status'];
  key_json: CaseAnswerKeyRecord['key'] | null;
  model: string;
  prompt_version: string;
  source_fingerprint: string;
  reason: string | null;
  dropped: CaseAnswerKeyRecord['dropped'];
  generated_at: string;
  updated_at: string;
}

export function recordToRow(record: CaseAnswerKeyRecord): CaseAnswerKeyRow {
  return {
    case_id: record.caseId,
    version: record.version,
    status: record.status,
    key_json: record.key,
    model: record.model,
    prompt_version: record.promptVersion,
    source_fingerprint: record.sourceFingerprint,
    reason: record.reason ?? null,
    dropped: record.dropped,
    generated_at: record.generatedAt,
    updated_at: new Date().toISOString(),
  };
}

export function rowToRecord(row: unknown): CaseAnswerKeyRecord | null {
  if (!row || typeof row !== 'object') return null;
  const value = row as Partial<CaseAnswerKeyRow>;
  const candidate = {
    caseId: value.case_id,
    version: value.version,
    status: value.status,
    key: value.key_json ?? null,
    model: value.model,
    promptVersion: value.prompt_version,
    sourceFingerprint: value.source_fingerprint,
    generatedAt: value.generated_at,
    ...(value.reason ? { reason: value.reason } : {}),
    dropped: Array.isArray(value.dropped) ? value.dropped : [],
  };
  return isCaseAnswerKeyRecord(candidate) ? candidate : null;
}

/** 读取一份标答；表不存在/无记录一律返回 null，由调用方决定是否生成。 */
export async function getCaseAnswerKey(caseId: string, version: string): Promise<CaseAnswerKeyRecord | null> {
  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from('case_answer_keys')
    .select('case_id,version,status,key_json,model,prompt_version,source_fingerprint,reason,dropped,generated_at,updated_at')
    .eq('case_id', caseId)
    .eq('version', version)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToRecord(data) : null;
}

export async function saveCaseAnswerKey(record: CaseAnswerKeyRecord): Promise<void> {
  const db = getSupabaseServiceClient();
  const { error } = await db
    .from('case_answer_keys')
    .upsert(recordToRow(record), { onConflict: 'case_id,version' });
  if (error) throw error;
}