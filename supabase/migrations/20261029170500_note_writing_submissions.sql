begin;

-- 批次6·独立病历书写模块（CASE_WORKFLOW_AND_NOTE_WRITING.md 第4节，全新建）：
-- 学生从指定病例接诊后书写病历：note_drafts 草稿（每学生×会话一份，仅本人读写），
-- note_submissions 提交（每次提交一行，原文不可变，保留提交版本历史）。
-- 教师按既有授权范围只读提交与 AI 意见（app_can_view_student + class_period 时间锚点收紧），
-- 不恢复已取消的任务发布/教师改分流程；AI 审阅为独立辅助反馈，不冒充医学审核、不改历史成绩。
-- 标准病历（teacher-case-data sections）仅服务端可读，不落本表、整篇不进学生响应/页面源码。
-- 工程纪律：迁移只新增不改历史；RLS 不放宽；幂等沿用 client_event_id 唯一约束范式；
-- 场景 C 用户归属列 user_id uuid default auth.uid()（防遗漏），WITH CHECK auth.uid()=user_id（防篡改）。

-- ============================================================
-- 1) 新表
-- ============================================================
create table note_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  session_id uuid not null references training_sessions(id) on delete cascade,
  template_version text not null default 'pediatric-general-v1',
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, session_id)
);

create index note_drafts_session_idx on note_drafts (session_id);

create table note_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  session_id uuid not null references training_sessions(id) on delete cascade,
  case_id text not null check (btrim(case_id) <> ''),
  case_version text,
  template_version text not null default 'pediatric-general-v1',
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  -- 提交幂等：同一次前端提交请求重试命中既有行，不重复插入
  client_event_id uuid,
  submitted_at timestamptz not null default now(),
  -- AI 审阅（独立辅助反馈）：pending（未审/排队）| ready（意见已生成）| failed（服务异常，不扣分不降级）
  ai_review_status text not null default 'pending' check (ai_review_status in ('pending', 'ready', 'failed')),
  ai_review jsonb,
  ai_prompt_version text,
  created_at timestamptz not null default now()
);

create index note_submissions_user_idx on note_submissions (user_id, submitted_at desc);
create index note_submissions_session_idx on note_submissions (session_id);
create unique index note_submissions_client_event_idx on note_submissions (user_id, client_event_id) where client_event_id is not null;

-- ============================================================
-- 2) RLS：enable + 最小授权 + 策略
-- ============================================================
alter table note_drafts enable row level security;
alter table note_submissions enable row level security;

revoke all on note_drafts, note_submissions from public, anon;

-- 草稿：仅本人读写（教师不可见学生草稿，仅查看提交）
grant select, insert, update, delete on note_drafts to authenticated;

-- 提交：本人读 + 插入；教师经策略只读。
-- 列级最小授权：提交原文与病例绑定不可变更；本人仅可写回 AI 审阅回填列（服务端以学生 JWT 调用）。
grant select, insert on note_submissions to authenticated;
grant update (ai_review_status, ai_review, ai_prompt_version) on note_submissions to authenticated;

create policy note_drafts_owner on note_drafts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy note_submissions_owner_write on note_submissions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy note_submissions_teacher_read on note_submissions
  for select to authenticated using (app_can_view_student(user_id));

-- restrictive 时间锚点：教师对学生病历提交的读取按归属期间收紧（对齐既有 class_period_* 模式）
create policy class_period_note_submissions on note_submissions as restrictive for select to authenticated
  using (user_id = auth.uid() or app_can_view_training(user_id, null, submitted_at));

commit;
