import type { AppRole } from '@/domain/agent';
import type { ChaoxingIdentity } from '@/lib/chaoxing-client';

const DEFAULT_TEST_TEACHER_FIDS = ['1385'];
const DEFAULT_PROVIDER_TEACHER_FIDS = ['1024'];
const DEFAULT_TEACHER_ROLE_IDS = new Set(['101']);

function values(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((item) => item.trim()).filter(Boolean));
}

export function isTeacherIdentityAllowed(
  identity: Pick<ChaoxingIdentity, 'fid' | 'uid' | 'role'>,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (isTestTeacherFid(identity.fid, env)) return true;

  const providerTeacher = identity.role.some((role) => (
    DEFAULT_TEACHER_ROLE_IDS.has(role.roleId) || /教师|teacher|管理员|教职工/i.test(role.roleName)
  ));
  if (isProviderTeacherFid(identity.fid, env)) return providerTeacher;
  return providerTeacher && values(env.CHAOXING_TEACHER_UIDS).has(identity.uid);
}

export function isTestTeacherFid(fid: string, env: Record<string, string | undefined> = process.env): boolean {
  return new Set([...DEFAULT_TEST_TEACHER_FIDS, ...values(env.CHAOXING_TEST_TEACHER_FIDS)]).has(fid);
}

export function isProviderTeacherFid(fid: string, env: Record<string, string | undefined> = process.env): boolean {
  return new Set([...DEFAULT_PROVIDER_TEACHER_FIDS, ...values(env.CHAOXING_PROVIDER_TEACHER_FIDS)]).has(fid);
}

export function canAccessRole(actual: AppRole, required: AppRole): boolean {
  return actual === required || (actual === 'teacher' && required === 'student');
}
