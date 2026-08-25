import type { NextRequest } from 'next/server';

export function getRealOrigin(request: NextRequest): string {
  const configured = process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (configured) return configured.startsWith('http') ? configured : `https://${configured}`;
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'http';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  return `${protocol}://${host}`;
}

export function normalizeSafeRedirectPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const parsed = new URL(value, 'https://local.invalid');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
