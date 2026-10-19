import { ZodError } from 'zod';
import { fail } from '@/lib/api-result';

export function classManagementError(error: unknown) {
  const detail = error as { message?: string; code?: string };
  const message = detail?.message ?? '';
  if (message.includes('AUTH_REQUIRED')) return fail({ code: 'AUTH_REQUIRED', message: '请先登录。', retryable: false }, undefined, 401);
  if (message.includes('FORBIDDEN') || detail?.code === '42501') return fail({ code: 'FORBIDDEN', message: '你没有执行此操作的权限。', retryable: false }, undefined, 403);
  if (error instanceof ZodError || error instanceof SyntaxError || message.includes('INVALID_INPUT')) return fail({ code: 'INVALID_INPUT', message: '请检查填写内容及名单格式。', retryable: false }, undefined, 400);
  if (message.includes('IDENTITY_CONFLICT') || detail?.code === '23505') return fail({ code: 'IDENTITY_CONFLICT', message: '编号或账号存在冲突，请联系管理员核对。', retryable: false }, undefined, 409);
  if (message.includes('NOT_FOUND')) return fail({ code: 'NOT_FOUND', message: '记录不存在或已不可用，请刷新后重试。', retryable: false }, undefined, 404);
  return fail({ code: 'CLASS_MANAGEMENT_UNAVAILABLE', message: '班级管理服务暂不可用，请稍后重试。', retryable: true }, undefined, 503);
}
