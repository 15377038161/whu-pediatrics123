/**
 * 教师题库 API 门控与请求 schema（阶段 F）：
 * - 门控与 case-drafts 同一谓词：应用层教师角色（requireAuth 'teacher'）AND 数据库白名单
 *   （app_is_teacher RPC，与数据层 RLS 同一函数），非白名单教师一律 403；
 * - 行级权限交给 RLS（owner 或项目管理员）与受控 RPC（quiz_bank_publish），本层不复制归属判定，
 *   仅做「读不到即 404」的投影；
 * - 请求体 schema 全部 strict（防字段混用），状态迁移白名单见 question-bank.ts。
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { isProjectAdmin } from '@/lib/question-bank';

export interface TeacherBankApiContext {
  userId: string;
  db: SupabaseClient;
  isAdmin: boolean;
}

/** 教师题库门控：身份交集 + 数据库配置 + 项目管理员标记（与 RLS 同一谓词）。 */
export async function resolveTeacherBankContext(request: NextRequest): Promise<TeacherBankApiContext> {
  const user = await requireAuth(request, 'teacher');
  if (!user.accessToken) throw new Error('AUTH_REQUIRED');
  if (!isDatabaseConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  if (!(await isTeacherByWhitelist(user.accessToken))) throw new Error('FORBIDDEN');
  const db = getSupabaseUserClient(user.accessToken);
  const isAdmin = await isProjectAdmin(db);
  return { userId: user.id, db, isAdmin };
}

export const createBankSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).optional(),
  topic: z.string().trim().max(120).optional(),
}).strict();

export const updateBankSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(600).nullable().optional(),
  topic: z.string().trim().max(120).nullable().optional(),
  // published 只能经发布 RPC 达成；此处仅允许工作流状态迁移（白名单校验在路由层）
  status: z.enum(['draft', 'ready_for_review', 'retired']).optional(),
}).strict();

export const updateItemSchema = z.object({
  stem: z.string().trim().min(8).max(600).optional(),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(8).optional(),
  answer: z.string().trim().min(1).max(200).optional(),
  explanation: z.string().trim().min(8).max(2000).optional(),
  knowledgePoint: z.string().trim().max(120).nullable().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  reviewStatus: z.enum(['draft', 'approved', 'rejected']).optional(),
}).strict().superRefine((value, context) => {
  // 改选项必须连带提交答案（保证 answer ∈ options 一致性）；数据库 CHECK 兜底既有行
  if (value.options && !value.answer) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['answer'], message: '修改选项时必须同时提交答案' });
  }
  if (value.options) {
    const distinct = new Set(value.options.map((option) => option.trim()));
    if (distinct.size !== value.options.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '选项存在重复' });
    }
  }
  if (value.options && value.answer && !value.options.map((option) => option.trim()).includes(value.answer)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['answer'], message: '答案必须为选项之一' });
  }
});

export const publishBankSchema = z.object({
  visibility: z.enum(['own_class', 'platform']).optional(),
}).strict();
