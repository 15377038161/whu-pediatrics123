begin;

-- 病例快照持久缓存：会话绑定固定快照版本后，服务重启/TTL 过期仍按版本恢复病例事实，防止知识库召回漂移导致“换患者”。
-- facts：登录可读的教学事实（不含诊断/诊疗经过/原文/媒体）；
-- answers：仅教师可读的完整诊断、诊疗经过、召回原文分片与来源媒体。
-- 注意：与实际数据库已建表结构一致（此前通过 db_execute 直接建表，此处补齐迁移记录以保证可复现）。

create table public.case_snapshot_facts (
  case_id text not null,
  version text not null,
  source_name text not null default '',
  facts jsonb not null,
  created_at timestamptz not null default now(),
  primary key (case_id, version)
);

create table public.case_snapshot_answers (
  case_id text not null,
  version text not null,
  diagnosis text not null default '',
  plan text not null default '',
  documents jsonb not null default '[]'::jsonb,
  media jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (case_id, version)
);

alter table public.case_snapshot_facts enable row level security;
alter table public.case_snapshot_answers enable row level security;

-- facts：登录用户可读（学生按绑定版本恢复教学事实）；
-- 插入开放给登录用户（ignoreDuplicates 防投毒：已存在版本不覆盖）；
-- 更新仅教师（防止学生篡改缓存的教学事实）。
create policy case_snapshot_facts_select on public.case_snapshot_facts
  for select to authenticated using (true);
create policy case_snapshot_facts_insert on public.case_snapshot_facts
  for insert to authenticated with check (true);
create policy case_snapshot_facts_teacher_manage on public.case_snapshot_facts
  for update to authenticated using (app_is_teacher()) with check (app_is_teacher());

-- answers：诊断/诊疗经过/原文/媒体 仅教师可读写。
create policy case_snapshot_answers_teacher on public.case_snapshot_answers
  for all to authenticated using (app_is_teacher()) with check (app_is_teacher());

commit;
