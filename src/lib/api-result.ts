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
  if (message.includes('NO_ELIGIBLE_CASE')) return { code: 'NO_ELIGIBLE_CASE', message: '暂无资料完整且已发布的病例，请稍后再试。', retryable: false };
  if (message.includes('ONLY_CURRENT_CASE')) return { code: 'ONLY_CURRENT_CASE', message: '目前只有当前病例可用，可以选择重新训练。', retryable: false };
  if (message.includes('CREATION_REQUEST_CONFLICT')) return { code: 'CREATION_REQUEST_CONFLICT', message: '创建请求已用于其他操作，请重新进入接诊页面。', retryable: false };
  if (message.includes('AUTH_REQUIRED')) return { code: 'AUTH_REQUIRED', message: '请先登录。', retryable: false };
  if (message.includes('FORBIDDEN')) return { code: 'FORBIDDEN', message: '你无权访问这条记录。', retryable: false };
  if (message.includes('SESSION_NOT_FOUND')) return { code: 'SESSION_NOT_FOUND', message: '未找到训练记录。', retryable: false };
  if (message.includes('REPORT_NOT_FOUND')) return { code: 'REPORT_NOT_FOUND', message: '未找到报告记录。', retryable: false };
  if (message.includes('CASE_SOURCE_INVALID')) return { code: 'CASE_SOURCE_INVALID', message: '病例资料格式异常，请重新生成教学病例数据。', retryable: false };
  if (message.includes('CASE_NOT_FOUND')) return { code: 'CASE_NOT_FOUND', message: '未找到该病例。', retryable: false };
  if (message.includes('CASE_UNPUBLISHED')) return { code: 'CASE_UNPUBLISHED', message: '该病例已被教师下架，暂时无法开始新的训练。', retryable: false };
  if (message.includes('CASE_INSUFFICIENT')) return { code: 'CASE_INSUFFICIENT', message: '该病种尚无独立病例资料，不能进入可评分测试。', retryable: false };
  if (message.includes('SESSION_COMPLETED')) return { code: 'SESSION_COMPLETED', message: '本次训练已经结束。', retryable: false };
  if (message.includes('TEST_NOT_FOUND')) return { code: 'TEST_NOT_FOUND', message: '未找到该检查项目，请从当前可选检查中选择。', retryable: false };
  if (message.includes('SESSION_STAGE_REGRESSION')) return { code: 'SESSION_STAGE_REGRESSION', message: '训练阶段不能回退，请继续当前阶段的操作。', retryable: false };
  if (message.includes('SESSION_STAGE_SKIP_FORBIDDEN')) return { code: 'SESSION_STAGE_SKIP_FORBIDDEN', message: '请先完成当前阶段（如开具辅助检查）再进入下一阶段。', retryable: false };
  if (message.includes('SESSION_BINDING_IMMUTABLE') || message.includes('SESSION_SNAPSHOT_BINDING_IMMUTABLE')) return { code: 'SESSION_BINDING_IMMUTABLE', message: '训练记录的病例绑定不可变更。', retryable: false };
  if (message.includes('SESSION_STATUS_REGRESSION')) return { code: 'SESSION_STATUS_REGRESSION', message: '本次训练已结束，状态不可回退。', retryable: false };
  if (message.includes('OSCE_EVENT_STAGE_FORBIDDEN')) return { code: 'OSCE_EVENT_STAGE_FORBIDDEN', message: 'OSCE 模式需按问诊、查体、检查、诊断、处置、沟通的顺序完成当前阶段。', retryable: false };
  if (message.includes('SESSION_EXPIRED')) return { code: 'SESSION_EXPIRED', message: '考站时间已到，系统将提交现有记录。', retryable: false };
  if (message.includes('INVALID_DATE_RANGE')) return { code: 'INVALID_DATE_RANGE', message: '开始日期不能晚于结束日期。', retryable: false };
  if (message.includes('INVALID_DETAIL')) return { code: 'INVALID_REQUEST', message: '事件数据无效。', retryable: false };
  if (message.includes('DATABASE_NOT_CONFIGURED')) return { code: 'DATABASE_NOT_CONFIGURED', message: 'Coze项目数据库尚未配置。', retryable: false };
  if (message.includes('TEST_ORDER_REJECTED')) return { code: 'TEST_ORDER_REJECTED', message: '当前会话状态不允许开单（可能已完成或项目不存在）。', retryable: false };
  if (message.includes('TEST_ORDER_RPC_FAILED')) return { code: 'RPC_UNAVAILABLE', message: '检查记录服务暂时不可用，本次开单未记录，请稍后重试。', retryable: true };
  if (message.includes('TEST_RESULT_RPC_FAILED') || message.includes('TEST_RESULT_UNAVAILABLE')) return { code: 'RPC_UNAVAILABLE', message: '检查结果暂时无法读取，本次开单未完成，请稍后重试。', retryable: true };
  if (/timeout|超时/i.test(message)) return { code: 'AI_TIMEOUT', message: '智能体响应超时，当前操作已经保留，请稍后重试。', retryable: true };
  return { code: 'INTERNAL_ERROR', message: '系统暂时无法完成该操作，请稍后重试。', retryable: true };
}
