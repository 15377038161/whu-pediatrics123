import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getTeacherCaseResourceRoot, getPlayableTeacherResource } from '@/lib/teacher-case-resources';
import { readTeacherCaseData } from '@/lib/teacher-case-data';
import { errorFromUnknown, fail } from '@/lib/api-result';
import { requireUser } from '@/lib/request-auth';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request, 'student');
    const { id } = await context.params;
    const root = getTeacherCaseResourceRoot(id);
    const relative = request.nextUrl.searchParams.get('path');
    if (!root || !relative) return new Response('Resource not found', { status: 404 });
    const resolvedRoot = await realpath(root);
    let resolved = await realpath(path.join(root, relative));
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) return new Response('Resource not found', { status: 404 });
    const sourceExtension = path.extname(resolved).toLowerCase();
    if (user.role === 'student' && ['.doc', '.docx', '.pdf', '.ppt', '.pptx', '.xlsx'].includes(sourceExtension)) {
      const source = readTeacherCaseData(id);
      const document = source?.documents.find((item) => item.source === path.relative(resolvedRoot, resolved).replaceAll('\\', '/'));
      if (!document) return new Response('暂无可读正文', { status: 404 });
      return new Response(document.text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
    }
    const playable = getPlayableTeacherResource(id, path.relative(resolvedRoot, resolved));
    if (playable) resolved = await realpath(playable);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext];
    if (!contentType) return new Response('Resource type not supported', { status: 415 });
    const info = await stat(resolved);
    if (!info.isFile()) return new Response('Resource not found', { status: 404 });
    if (info.size === 0) return new Response(null, { status: 200, headers: { 'Content-Type': contentType, 'Content-Length': '0', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    const range = request.headers.get('range');
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (range && (!match || start > end || start >= info.size)) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': 'sandbox' };
    if (match) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    return new Response(Readable.toWeb(createReadStream(resolved, { start, end })) as ReadableStream, { status: match ? 206 : 200, headers });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 404);
  }
}
