begin;

-- 教师病例草稿导入（最小实现）：
-- 草稿与运行中事实快照（case_snapshot_facts/answers）完全隔离：
--   - 草稿仅存本表，case 加载器与学生 RPC（case_snapshot_get_facts/get_reference）不读本表，
--     草稿永远不会被当作已审核病例事实参与训练或评分；
--   - 本阶段无学生发布动作：草稿状态固定 'draft'，无 published 流转。
-- 防覆盖：表级无 UPDATE/DELETE 策略（默认拒绝）。教师修订通过新 draft_version（v2）插入，
--   旧版本自然保留；同一 (case_id, draft_version) 重复导入触发唯一约束，应用层返回明确冲突结果。
-- 跨租户写入防护：沿用租户 schema 隔离 + RLS 教师判定（app_is_teacher()）。

create table case_draft_imports (
  id uuid primary key default gen_random_uuid(),
  case_id text not null,
  draft_version text not null,
  source_name text not null default '',
  source_kind text not null default 'structured_json',
  alias_source_id text,
  payload jsonb not null,
  missing_fields jsonb not null default '[]'::jsonb,
  completeness jsonb not null default '{}'::jsonb,
  desensitized boolean not null default false,
  media_reviewed boolean not null default false,
  status text not null default 'draft',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (case_id, draft_version),
  constraint case_draft_status_draft_only check (status = 'draft')
);

alter table case_draft_imports enable row level security;

-- 仅教师可读、可插入（RLS）；无 UPDATE/DELETE 策略 = 修订走新版本号，禁止覆盖与删除。
create policy case_draft_teacher_select on case_draft_imports
  for select to authenticated
  using (app_is_teacher());

create policy case_draft_teacher_insert on case_draft_imports
  for insert to authenticated
  with check (app_is_teacher());

-- === managed grants ===
revoke all on case_draft_imports from anon, authenticated;
grant select, insert on case_draft_imports to authenticated;

commit;
