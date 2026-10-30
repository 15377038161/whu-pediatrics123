import { getSupabaseUserClient } from '@/lib/supabase-client';

/** Entry-scoped publication metadata; no patient facts or answers are exposed. */
export async function getActiveCaseVersion(caseId: string, accessToken: string): Promise<string | null> {
  const { data, error } = await getSupabaseUserClient(accessToken).from('case_publication')
    .select('active_version').eq('case_id', decodeURIComponent(caseId)).maybeSingle();
  if (error) throw new Error('CASE_ACTIVE_VERSION_UNAVAILABLE');
  const version = data?.active_version;
  if (version == null) return null;
  if (typeof version !== 'string' || !/^[a-f0-9]{16}$/.test(version)) throw new Error('CASE_ACTIVE_VERSION_INVALID');
  return version;
}
