import type { NextRequest } from 'next/server';
import { errorFromUnknown, fail } from '@/lib/api-result';
import { getResourcePlaybackLink } from '@/lib/learning-resource';
import { verifyPlaybackStreamToken } from '@/lib/learning-resource-playback-stream';

export const dynamic = 'force-dynamic';

function getVideoContentType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'ogv' || extension === 'ogg') return 'video/ogg';
  throw new Error('FILE_UNAVAILABLE');
}

async function handlePlaybackStream(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const grant = verifyPlaybackStreamToken(request.nextUrl.searchParams.get('token'), id);
    const link = await getResourcePlaybackLink(grant.fileId);
    const range = request.headers.get('range');
    const upstream = await fetch(link.url, {
      method: request.method,
      headers: range ? { Range: range } : undefined,
      cache: 'no-store',
    });

    if (upstream.status === 416) {
      const headers = new Headers({ 'Cache-Control': 'private, no-store' });
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) headers.set('Content-Range', contentRange);
      return new Response(null, { status: 416, headers });
    }
    if (!upstream.ok || (upstream.status !== 200 && upstream.status !== 206)) {
      throw new Error('FILE_UNAVAILABLE');
    }

    const headers = new Headers({
      'Content-Type': getVideoContentType(link.fileName ?? ''),
      'Content-Disposition': 'inline',
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'PLAYBACK_URL_INVALID' ? 403 : detail.code === 'FILE_UNAVAILABLE' ? 503 : 500;
    return fail(detail, undefined, status);
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handlePlaybackStream(request, context);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handlePlaybackStream(request, context);
}
