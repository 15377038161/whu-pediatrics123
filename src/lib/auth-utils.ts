import type { NextRequest } from 'next/server';

export function getRealOrigin(request: NextRequest): string {
  // 平台注入的对外域名（完整 https URL）最可信：网关→容器内部链路的
  // x-forwarded-proto 是 http，用它会导致重定向 Location 协议降级，
  // 浏览器从 https 跟随 http 跳转时触发网关代理前缀双层拼接（404）。
  const platform = process.env.CODER_PROJECTS_DOMAIN?.trim();
  if (platform) return platform.startsWith('http') ? platform : `https://${platform}`;
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
