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
  if(message.includes('DECISION_EVIDENCE_'))return {code:'INVALID_REQUEST',message:'关联记录未在本次接诊中实际获得，或提交格式无效。请刷新后重新选择。',retryable:false};
  if (message.includes('NO_ELIGIBLE_CASE')) return { code: 'NO_ELIGIBLE_CASE', message: '暂无资料完整且已发布的病例，请稍后再试。', retryable: false };
  if (message.includes('BANK_NOT_FOUND')) return { code: 'BANK_NOT_FOUND', message: '未找到该题集（或不在你的管理范围内）。', retryable: false };
  if (message.includes('ITEM_NOT_FOUND')) return { code: 'ITEM_NOT_FOUND', message: '未找到该题目条目。', retryable: false };
  if (message.includes('NO_APPROVED_ITEMS')) return { code: 'NO_APPROVED_ITEMS', message: '尚无审核通过的题目，请先在题集中审核通过至少 1 题后再发布。', retryable: false };
  if (message.includes('DUPLICATE_OPTIONS')) return { code: 'DUPLICATE_OPTIONS', message: '存在选项重复的题目，请修正后再发布。', retryable: false };
  if (message.includes('BANK_HAS_VERSIONS')) return { code: 'BANK_HAS_VERSIONS', message: '该题集已发布过版本，不能删除（学生练习记录受保护）；可先下架或继续修订再发布。', retryable: false };
  if (message.includes('ATTEMPT_CLOSED')) return { code: 'ATTEMPT_CLOSED', message: '本次练习已结束，请返回题库列表重新开始。', retryable: false };
  if (message.includes('AI_GENERATION_INVALID')) return { code: 'AI_GENERATION_INVALID', message: 'AI 生成结果未通过校验，本次生成已丢弃；请调整主题描述后重试。', retryable: true };
  if (message.includes('INVALID_VISIBILITY')) return { code: 'INVALID_VISIBILITY', message: '可见范围设置无效。', retryable: false };
  if (message.includes('RESOURCE_NOT_FOUND')) return { code: 'RESOURCE_NOT_FOUND', message: '未找到该学习资源（或不在你的可见范围内）。', retryable: false };
  if (message.includes('FILE_UNAVAILABLE')) return { code: 'FILE_UNAVAILABLE', message: '资源文件暂时无法访问，请稍后重试。', retryable: true };
  if (message.includes('FILE_REQUIRED')) return { code: 'FILE_REQUIRED', message: '该资源尚未绑定文件，请先在管理端补充文件后再发布。', retryable: false };
  if (message.includes('VISIBILITY_REQUIRED')) return { code: 'VISIBILITY_REQUIRED', message: '发布前请至少为本班授予一个可见班级。', retryable: false };
  if (message.includes('OWNER_PROTECTED')) return { code: 'OWNER_PROTECTED', message: '资源维护者不可变更。', retryable: false };
  if (message.includes('SCOPE_PROTECTED')) return { code: 'SCOPE_PROTECTED', message: '全平台可见范围仅项目管理员可设置。', retryable: false };
  if (message.includes('INVALID_STATUS_TRANSITION')) return { code: 'INVALID_STATUS_TRANSITION', message: '资源状态变更不合法（草稿→发布→下架→重新编辑）。', retryable: false };
  if (message.includes('RESOURCE_LIST_FAILED') || message.includes('RESOURCE_GET_FAILED') || message.includes('RESOURCE_PROGRESS_FAILED') || message.includes('RESOURCE_SAVE_FAILED')) return { code: 'RPC_UNAVAILABLE', message: '学习资源服务暂时不可用，请稍后重试。', retryable: true };
  if (message.includes('DELETE_DRAFT_ONLY')) return { code: 'DELETE_DRAFT_ONLY', message: '仅草稿可删除；已发布或下架过的资源保留学生进度历史，请使用下架。', retryable: false };
  if (message.includes('INVALID_REQUEST')) return { code: 'INVALID_REQUEST', message: '请求参数无效。', retryable: false };
  if (message.includes('ONLY_CURRENT_CASE')) return { code: 'ONLY_CURRENT_CASE', message: '目前只有当前病例可用，可以选择重新训练。', retryable: false };
  if (message.includes('CREATION_REQUEST_CONFLICT')) return { code: 'CREATION_REQUEST_CONFLICT', message: '创建请求已用于其他操作，请重新进入接诊页面。', retryable: false };
  if (message.includes('AUTH_REQUIRED')) return { code: 'AUTH_REQUIRED', message: '请先登录。', retryable: false };
  if (message.includes('FORBIDDEN')) return { code: 'FORBIDDEN', message: '你无权访问这条记录。', retryable: false };
  if (message.includes('SESSION_NOT_FOUND')) return { code: 'SESSION_NOT_FOUND', message: '未找到训练记录。', retryable: false };
  if (message.includes('STUDENT_NOT_FOUND')) return { code: 'STUDENT_NOT_FOUND', message: '未找到该学生档案（或不在你的授权范围内）。', retryable: false };
  if (message.includes('REPORT_NOT_FOUND')) return { code: 'REPORT_NOT_FOUND', message: '未找到报告记录。', retryable: false };
  if (message.includes('CASE_SOURCE_INVALID')) return { code: 'CASE_SOURCE_INVALID', message: '病例资料格式异常，请重新生成教学病例数据。', retryable: false };
  if (message.includes('CASE_NOT_FOUND')) return { code: 'CASE_NOT_FOUND', message: '未找到该病例。', retryable: false };
  if (message.includes('CASE_RETIRED')) return { code: 'CASE_RETIRED', message: '该病例已停用，历史接诊记录和报告保留为只读。', retryable: false };
  if (message.includes('CASE_UNPUBLISHED')) return { code: 'CASE_UNPUBLISHED', message: '该病例已被教师下架，暂时无法开始新的训练。', retryable: false };
  if (message.includes('CASE_INSUFFICIENT')) return { code: 'CASE_INSUFFICIENT', message: '该病种尚无独立病例资料，不能进入可评分测试。', retryable: false };
  if (message.includes('SESSION_COMPLETED')) return { code: 'SESSION_COMPLETED', message: '本次训练已经结束。', retryable: false };
  if (message.includes('TEST_NOT_FOUND')) return { code: 'TEST_NOT_FOUND', message: '未找到该检查项目，请从当前可选检查中选择。', retryable: false };
  if (message.includes('SESSION_STAGE_REGRESSION')) return { code: 'SESSION_STAGE_REGRESSION', message: '训练阶段不能回退，请继续当前阶段的操作。', retryable: false };
  if (message.includes('SESSION_STAGE_SKIP_FORBIDDEN')) return { code: 'SESSION_STAGE_SKIP_FORBIDDEN', message: '请先完成当前阶段（如开具辅助检查）再进入下一阶段。', retryable: false };
  if (message.includes('SESSION_BINDING_IMMUTABLE') || message.includes('SESSION_SNAPSHOT_BINDING_IMMUTABLE')) return { code: 'SESSION_BINDING_IMMUTABLE', message: '训练记录的病例绑定不可变更。', retryable: false };
  if (message.includes('SESSION_STATUS_REGRESSION')) return { code: 'SESSION_STATUS_REGRESSION', message: '本次训练已结束，状态不可回退。', retryable: false };
  if (message.includes('OSCE_EVENT_STAGE_FORBIDDEN')) return { code: 'OSCE_EVENT_STAGE_FORBIDDEN', message: 'OSCE 模式需按问诊、查体、检查、诊断、处置、沟通的顺序完成当前阶段。', retryable: false };
  if (message.includes('SESSION_EXPIRED')) return { code: 'SESSION_EXPIRED', message: '模拟站时间已到，系统将冻结已确认提交并生成模拟参考评分。', retryable: false };
  if (message.includes('INVALID_DATE_RANGE')) return { code: 'INVALID_DATE_RANGE', message: '开始日期不能晚于结束日期。', retryable: false };
  if (message.includes('INVALID_DETAIL')) return { code: 'INVALID_REQUEST', message: '事件数据无效。', retryable: false };
  if (message.includes('DATABASE_NOT_CONFIGURED')) return { code: 'DATABASE_NOT_CONFIGURED', message: 'Coze项目数据库尚未配置。', retryable: false };
  if (message.includes('TEST_ORDER_REJECTED')) return { code: 'TEST_ORDER_REJECTED', message: '当前会话状态不允许开单（可能已完成或项目不存在）。', retryable: false };
  if (message.includes('TEST_ORDER_RPC_FAILED')) return { code: 'RPC_UNAVAILABLE', message: '检查记录服务暂时不可用，本次开单未记录，请稍后重试。', retryable: true };
  if (message.includes('TEST_RESULT_RPC_FAILED') || message.includes('TEST_RESULT_UNAVAILABLE')) return { code: 'RPC_UNAVAILABLE', message: '检查结果暂时无法读取，本次开单未完成，请稍后重试。', retryable: true };
  if (/timeout|超时/i.test(message)) return { code: 'AI_TIMEOUT', message: '智能体响应超时，当前操作已经保留，请稍后重试。', retryable: true };
  return { code: 'INTERNAL_ERROR', message: '系统暂时无法完成该操作，请稍后重试。', retryable: true };
}
