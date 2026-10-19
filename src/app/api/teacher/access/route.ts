import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient } from '@/lib/supabase-client';
import { teacherAccessSchema } from '@/lib/class-management';
import { classManagementError } from '@/lib/class-management-error';
import { ok } from '@/lib/api-result';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    if (!user.accessToken) throw new Error('FORBIDDEN');
    const cxid = request.nextUrl.searchParams.get('cxid') ?? '';
    if (cxid && !/^\d{1,32}$/.test(cxid)) throw new Error('INVALID_INPUT');
    const { data, error } = await getSupabaseUserClient(user.accessToken).rpc('teacher_access_workspace', { p_cxid: cxid });
    if (error) throw error;
    return ok(data);
  } catch (error) { return classManagementError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    if (!user.accessToken) throw new Error('FORBIDDEN');
    const input = teacherAccessSchema.parse(await request.json());
    const { data, error } = await getSupabaseUserClient(user.accessToken).rpc(
      input.action === 'grant' ? 'teacher_access_grant' : 'teacher_access_revoke',
      input.action === 'grant' ? { p_user_id: input.userId, p_cxid: input.cxid, p_confirmed: input.confirmed } : { p_user_id: input.userId, p_confirmed: input.confirmed },
    );
    if (error) throw error;
    return ok(data);
  } catch (error) { return classManagementError(error); }
}
export const dynamic = 'force-dynamic';
