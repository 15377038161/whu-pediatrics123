import { NextRequest } from 'next/server';
import { extractForwardHeaders } from 'coder-coding-dev-sdk';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { probeSpeechCapabilities } from '@/lib/speech-service';

/**
 * 语音能力探测（阶段 D）：服务端真实探测平台音色列表（listVoices），
 * 探测失败如实返回 unavailable（前端据此隐藏语音入口）——启用状态不来自前端常量。
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    const forwardHeaders = extractForwardHeaders(Object.fromEntries(request.headers.entries()));
    const capabilities = await probeSpeechCapabilities(forwardHeaders);
    return ok(capabilities);
  } catch (error) {
    const detail = errorFromUnknown(error);
    console.error(`[speech] GET /api/speech/capabilities failed code=${detail.code}`);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : 500;
    return fail(detail, undefined, status);
  }
}
