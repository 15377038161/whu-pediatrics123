import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_POSITION_SECONDS, parsePositionSeconds } from '@/lib/learning-resource';
import {
  createResourceSchema,
  isUuid,
  publishResourceSchema,
  updateResourceSchema,
  visibilitySchema,
} from '@/lib/learning-resource-teacher';
import { errorFromUnknown } from '@/lib/api-result';

const UUID = '00000000-0000-4000-8000-000000000001';
const COHORT = '00000000-0000-4000-8000-000000000002';

/** 进度上报纯函数：非负、有限、≤24h，取整；非法输入一律 null（路由层据此 400）。 */
test('parsePositionSeconds：合法秒数取整，负数/NaN/超 24h 拒绝', () => {
  assert.equal(parsePositionSeconds(0), 0);
  assert.equal(parsePositionSeconds(42.9), 42);
  assert.equal(parsePositionSeconds('120'), 120);
  assert.equal(parsePositionSeconds(MAX_POSITION_SECONDS), MAX_POSITION_SECONDS);
  assert.equal(parsePositionSeconds(-1), null);
  assert.equal(parsePositionSeconds(NaN), null);
  assert.equal(parsePositionSeconds('abc'), null);
  assert.equal(parsePositionSeconds(null), null);
  assert.equal(parsePositionSeconds(MAX_POSITION_SECONDS + 1), null);
  assert.equal(parsePositionSeconds(Infinity), null);
});

/** 教师端 schema：字段 strict（防字段混用）、标题 2-120、时长 0-24h、班级上限 50。 */
test('createResourceSchema：标题/类型/时长边界与 strict 校验', () => {
  assert.equal(createResourceSchema.safeParse({ title: '心肺复苏', kind: 'video' }).success, true);
  assert.equal(createResourceSchema.safeParse({ title: 'x', kind: 'video' }).success, false);
  assert.equal(createResourceSchema.safeParse({ title: 'y'.repeat(121), kind: 'video' }).success, false);
  assert.equal(createResourceSchema.safeParse({ title: '无类型' }).success, false);
  assert.equal(createResourceSchema.safeParse({ title: '心肺复苏', kind: 'vr' }).success, false);
  assert.equal(createResourceSchema.safeParse({ title: '心肺复苏', kind: 'video', hack: 1 }).success, false);
  assert.equal(createResourceSchema.safeParse({ title: '心肺复苏', kind: 'document', durationSeconds: -1 }).success, false);
  assert.equal(createResourceSchema.safeParse({ title: '心肺复苏', kind: 'video', durationSeconds: 24 * 60 * 60 + 1 }).success, false);
  assert.equal(createResourceSchema.safeParse({ title: '心肺复苏', kind: 'video', durationSeconds: 318 }).success, true);
  // 元数据编辑不暴露 status/scope/owner_id（状态只能经发布/下架路由）
  assert.equal(updateResourceSchema.safeParse({ status: 'published' }).success, false);
  assert.equal(updateResourceSchema.safeParse({ scope: 'platform' }).success, false);
  assert.equal(updateResourceSchema.safeParse({ owner_id: UUID }).success, false);
  assert.equal(updateResourceSchema.safeParse({ title: '修订后的标题' }).success, true);
});

test('visibilitySchema / publishResourceSchema：班级 UUID 上限 50、scope 仅 class|platform', () => {
  assert.equal(visibilitySchema.safeParse({ cohortIds: [COHORT] }).success, true);
  assert.equal(visibilitySchema.safeParse({ cohortIds: [] }).success, true);
  assert.equal(visibilitySchema.safeParse({ cohortIds: ['not-uuid'] }).success, false);
  assert.equal(visibilitySchema.safeParse({ cohortIds: Array.from({ length: 51 }, (_, i) => COHORT) }).success, false);
  assert.equal(visibilitySchema.safeParse({ cohortIds: [COHORT], extra: 1 }).success, false);
  assert.equal(publishResourceSchema.safeParse({}).success, true);
  assert.equal(publishResourceSchema.safeParse({ scope: 'platform' }).success, true);
  assert.equal(publishResourceSchema.safeParse({ scope: 'school' }).success, false);
});

test('isUuid：标准 UUID 形态', () => {
  assert.equal(isUuid(UUID), true);
  assert.equal(isUuid(COHORT), true);
  assert.equal(isUuid('not-uuid'), false);
  assert.equal(isUuid(''), false);
});

/** 错误码翻译：数据库写守卫码 → 领域码中文文案；保存失败 → 可重试。 */
test('errorFromUnknown：资源守卫与保存错误映射', () => {
  assert.equal(errorFromUnknown(new Error('FILE_REQUIRED')).code, 'FILE_REQUIRED');
  assert.equal(errorFromUnknown(new Error('VISIBILITY_REQUIRED')).code, 'VISIBILITY_REQUIRED');
  assert.equal(errorFromUnknown(new Error('SCOPE_PROTECTED')).code, 'SCOPE_PROTECTED');
  assert.equal(errorFromUnknown(new Error('OWNER_PROTECTED')).code, 'OWNER_PROTECTED');
  assert.equal(errorFromUnknown(new Error('INVALID_STATUS_TRANSITION')).code, 'INVALID_STATUS_TRANSITION');
  assert.equal(errorFromUnknown(new Error('RESOURCE_NOT_FOUND')).code, 'RESOURCE_NOT_FOUND');
  const saveError = errorFromUnknown(new Error('RESOURCE_SAVE_FAILED: connection reset'));
  assert.equal(saveError.code, 'RPC_UNAVAILABLE');
  assert.equal(saveError.retryable, true);
  assert.equal(errorFromUnknown(new Error('DELETE_DRAFT_ONLY')).code, 'DELETE_DRAFT_ONLY');
});

/**
 * 迁移静态重放（只读文件，不执行 SQL、不触碰数据库）：
 * - 学生访问面无表直读：learning_resources / resource_progress 不存在 for select to student 语句；
 * - 进度表无学生写策略（写入仅经 SECURITY DEFINER RPC）；
 * - 写守卫触发器含发布前置校验（FILE_REQUIRED / VISIBILITY_REQUIRED）与状态白名单；
 * - 三表 RLS 启用、RPC 授权收口（revoke public/anon → grant authenticated）。
 */
test('迁移 20261023000000：学生无直读面、进度仅 RPC 写、守卫与 RLS 在位', () => {
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261023000000_learning_resources.sql'), 'utf8');
  // RLS 启用
  for (const table of ['learning_resources', 'resource_class_visibility', 'resource_progress']) {
    assert.ok(sql.includes(`alter table ${table} enable row level security`), `${table} RLS 未启用`);
  }
  // 守卫语义
  assert.ok(sql.includes("raise exception 'FILE_REQUIRED'"), '发布未强制 file_id');
  assert.ok(sql.includes("raise exception 'VISIBILITY_REQUIRED'"), '发布未强制班级授权');
  assert.ok(sql.includes("raise exception 'SCOPE_PROTECTED'"), 'scope 未受保护');
  assert.ok(sql.includes("raise exception 'OWNER_PROTECTED'"), 'owner 未受保护');
  assert.ok(sql.includes("raise exception 'INVALID_STATUS_TRANSITION'"), '状态白名单缺失');
  // 学生直读面：learning_resources 仅维护者/教师已发布/管理员策略，无 to student；
  // resource_progress 仅本人 select。此处静态断言策略集合中不含学生写策略。
  const progressPolicies = sql.split('create policy resource_progress_self_select')[1] ?? '';
  assert.ok(progressPolicies.includes('for select to authenticated using (user_id = auth.uid())'));
  assert.ok(!progressPolicies.includes('for insert'), '进度表出现学生直写策略');
  assert.ok(!progressPolicies.includes('for update'), '进度表出现学生直改策略');
  // RPC 授权收口
  for (const fn of ['resource_list_student()', 'resource_get_student(uuid)', 'resource_progress_upsert(uuid, integer)']) {
    assert.ok(sql.includes(`revoke all on function ${fn} from public, anon`), `${fn} 未 revoke public/anon`);
    assert.ok(sql.includes(`grant execute on function ${fn} to authenticated`), `${fn} 未 grant authenticated`);
  }
  // RPC security definer（学生经投影访问，不直读表）
  for (const fn of ['resource_list_student', 'resource_get_student', 'resource_progress_upsert']) {
    assert.ok(new RegExp(`function\\s+${fn}[\\s\\S]*?security definer`, 'm').test(sql), `${fn} 非 security definer`);
  }
});
