import { createHash } from 'node:crypto';
import type { ChaoxingIdentity } from '@/lib/chaoxing-client';
import { getSupabaseAdminClient } from '@/lib/supabase-client';

function virtualEmail(providerUid: string): string {
  return `chaoxing_${createHash('sha256').update(providerUid).digest('hex').slice(0, 48)}@oauth.invalid`;
}

function teacherAllowed(identity: ChaoxingIdentity): boolean {
  const providerTeacher = identity.role.some((role) => /教师|teacher|管理员/i.test(role.roleName));
  const allowlist = new Set((process.env.CHAOXING_TEACHER_UIDS ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  return providerTeacher && allowlist.has(identity.uid);
}

export async function createSupabaseLoginToken(identity: ChaoxingIdentity): Promise<string> {
  const admin = getSupabaseAdminClient();
  const email = virtualEmail(identity.uid);
  const appRole = teacherAllowed(identity) ? 'teacher' : 'student';
  const appMetadata = {
    provider: 'chaoxing',
    app: { role: appRole },
    chaoxing: {
      openid: identity.openid,
      uid: identity.uid,
      name: identity.name,
      displayName: identity.displayName,
      studentNo: identity.studentNo,
      fid: identity.fid,
      orgName: identity.orgName,
      role: identity.role,
      loginNames: identity.loginNames,
    },
  };
  const userMetadata = { full_name: identity.displayName, avatar_url: identity.avatar };
  await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: appMetadata, user_metadata: userMetadata });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError || !link.properties?.hashed_token || !link.user?.id) throw new Error('SESSION_CREATE_FAILED');
  await admin.auth.admin.updateUserById(link.user.id, {
    app_metadata: { ...link.user.app_metadata, ...appMetadata },
    user_metadata: { ...link.user.user_metadata, ...userMetadata },
  });
  const { error: profileError } = await admin.from('profiles').upsert({
    id: link.user.id,
    display_name: identity.displayName,
    app_role: appRole,
    student_no: appRole === 'student' ? identity.studentNo || null : null,
    chaoxing_uid: identity.uid,
    institution_fid: identity.fid,
  }, { onConflict: 'id' });
  if (profileError) throw profileError;
  const { error: identityError } = await admin.from('external_identities').upsert({
    user_id: link.user.id,
    provider: 'chaoxing',
    provider_uid: identity.uid,
    provider_role: appRole,
    metadata: { fid: identity.fid, orgName: identity.orgName, roles: identity.role },
  }, { onConflict: 'provider,provider_uid' });
  if (identityError) throw identityError;
  const { error: cohortError } = await admin.from('cohort_members').upsert({
    cohort_id: '10000000-0000-4000-8000-000000000102',
    user_id: link.user.id,
    role: appRole,
  }, { onConflict: 'cohort_id,user_id' });
  if (cohortError) throw cohortError;
  return link.properties.hashed_token;
}
