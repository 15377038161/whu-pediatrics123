import { NextRequest, NextResponse } from 'next/server';
import { getRealOrigin, normalizeSafeRedirectPath } from '@/lib/auth-utils';
import { isPreviewEnabled, setPreviewCookie } from '@/lib/preview-auth';

export async function GET(request: NextRequest) {
  if (!isPreviewEnabled()) return NextResponse.json({ error: 'Preview disabled' }, { status: 404 });
  const role = request.nextUrl.searchParams.get('role') === 'teacher' ? 'teacher' : 'student';
  const fallback = role === 'teacher' ? '/teacher' : '/student';
  const next = normalizeSafeRedirectPath(request.nextUrl.searchParams.get('next')) || fallback;
  const response = NextResponse.redirect(new URL(next, getRealOrigin(request)));
  setPreviewCookie(response, role);
  return response;
}
