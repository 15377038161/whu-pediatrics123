import { NextRequest, NextResponse } from 'next/server';
import { clearPreviewCookie, readPreviewUser } from '@/lib/preview-auth';
import { createSupabaseRouteClient } from '@/lib/supabase-ssr';
import { SUPABASE_AUTH_COOKIE_NAME } from '@/lib/supabase-cookie-config';

export async function POST(request: NextRequest) {
  if (readPreviewUser(request.cookies)) {
    const response = NextResponse.json({ ok: true });
    clearPreviewCookie(response);
    return response;
  }
  try {
    const { supabase, applyToResponse } = createSupabaseRouteClient(request);
    const response = NextResponse.json({ ok: true });
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) response.cookies.set(SUPABASE_AUTH_COOKIE_NAME, '', { path: '/', maxAge: 0 });
    return applyToResponse(response);
  } catch {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SUPABASE_AUTH_COOKIE_NAME, '', { path: '/', maxAge: 0 });
    return response;
  }
}
