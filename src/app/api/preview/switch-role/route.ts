import { NextResponse, type NextRequest } from 'next/server';
import { PREVIEW_COOKIE, clearPreviewCookie, isPreviewEnabled, readPreviewUser, setPreviewCookie } from '@/lib/preview-auth';
import { ok } from '@/lib/api-result';

const MAX_AGE = 60 * 60 * 8;

export async function POST(request: NextRequest) {
  const cookieUser = readPreviewUser(request.cookies);
  if (!cookieUser || cookieUser.provider !== 'preview') {
    return NextResponse.json({ ok: false, error: { message: '仅预览用户可切换角色。', code: 'PREVIEW_ONLY' } }, { status: 403 });
  }
  if (!isPreviewEnabled()) {
    return NextResponse.json({ ok: false, error: { message: '预览入口未开启。', code: 'PREVIEW_DISABLED' } }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { role?: string } | null;
  const targetRole = body?.role === 'teacher' ? 'teacher' : body?.role === 'student' ? 'student' : null;
  if (!targetRole) {
    return NextResponse.json({ ok: false, error: { message: '无效的角色。', code: 'INVALID_ROLE' } }, { status: 400 });
  }
  const res = NextResponse.json(ok({ role: targetRole }), { status: 200 });
  setPreviewCookie(res, targetRole);
  return res;
}

export function DELETE(request: NextRequest) {
  const res = NextResponse.json(ok({ cleared: true }), { status: 200 });
  clearPreviewCookie(res);
  return res;
}
