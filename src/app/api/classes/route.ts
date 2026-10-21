import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient } from '@/lib/supabase-client';
import { classActionRpc, classActionSchema, isStudentSelfAction } from '@/lib/class-management';
import { ok } from '@/lib/api-result';
import { classManagementError } from '@/lib/class-management-error';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user.accessToken) throw new Error('FORBIDDEN');
    const id = request.nextUrl.searchParams.get('classId');
    if (id && !z.string().uuid().safeParse(id).success) throw new Error('INVALID_INPUT');
    const { data, error } = await getSupabaseUserClient(user.accessToken).rpc('class_workspace', { p_class_id: id });
    if (error) throw error;
    return ok(data);
  } catch (error) { return classManagementError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user.accessToken) throw new Error('FORBIDDEN');
    if (Number(request.headers.get('content-length')) > 500_000) throw new Error('INVALID_INPUT');
    const text = await request.text();
    if (text.length > 500_000) throw new Error('INVALID_INPUT');
    const input = classActionSchema.parse(JSON.parse(text));
    // 学生自助动作（首次自选/跳过/一次换班）对所有登录用户开放；其余（create/import/archive）仅教师。
    if (!isStudentSelfAction(input) && user.role !== 'teacher') throw new Error('FORBIDDEN');
    const rpc = classActionRpc(input);
    const { data, error } = await getSupabaseUserClient(user.accessToken).rpc(rpc.name, rpc.args);
    if (error) throw error;
    return ok(data);
  } catch (error) { return classManagementError(error); }
}
export const dynamic = 'force-dynamic';
