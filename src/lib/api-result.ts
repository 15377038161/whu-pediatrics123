import { NextResponse } from 'next/server';
import type { ApiError, ApiResult } from '@/domain/agent';

export function requestId(): string {
  return crypto.randomUUID();
}

export function ok<T>(data: T, id = requestId(), status = 200): NextResponse<ApiResult<T>> {
  return NextResponse.json({ ok: true, data, requestId: id }, { status });
}

export function fail(error: ApiError, id = requestId(), status = 400): NextResponse<ApiResult<never>> {
  return NextResponse.json({ ok: false, error, requestId: id }, { status });
}

export function errorFromUnknown(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('AUTH_REQUIRED')) return { code: 'AUTH_REQUIRED', message: '请先登录。', retryable: false };
  if (message.includes('FORBIDDEN')) return { code: 'FORBIDDEN', message: '你无权访问这条记录。', retryable: false };
  if (message.includes('SESSION_NOT_FOUND')) return { code: 'SESSION_NOT_FOUND', message: '未找到训练记录。', retryable: false };
  if (message.includes('REPORT_NOT_FOUND')) return { code: 'REPORT_NOT_FOUND', message: '未找到报告记录。', retryable: false };
  if (message.includes('SESSION_COMPLETED')) return { code: 'SESSION_COMPLETED', message: '本次训练已经结束。', retryable: false };
  if (message.includes('SESSION_EXPIRED')) return { code: 'SESSION_EXPIRED', message: '考站时间已到，系统将提交现有记录。', retryable: false };
  if (message.includes('DATABASE_NOT_CONFIGURED')) return { code: 'DATABASE_NOT_CONFIGURED', message: 'Coze项目数据库尚未配置。', retryable: false };
  if (/timeout|超时/i.test(message)) return { code: 'AI_TIMEOUT', message: '智能体响应超时，当前操作已经保留，请稍后重试。', retryable: true };
  return { code: 'INTERNAL_ERROR', message: '系统暂时无法完成该操作，请稍后重试。', retryable: true };
}
