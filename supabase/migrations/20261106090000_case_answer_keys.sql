-- 病例分析标答（B6 接线第 0 步）
-- 一条记录对应「病例 + 内容指纹」的一份五段评分点：
--   status = 'auto'           AI 从原件生成并通过自动原文回校，可用于判分
--   status = 'not_assessable' 生成/回校失败，不产出标答；调用方必须回退过程分并明确标注
-- 学生不直读本表：标答只在服务端判分时使用，报告只下发逐点命中/漏项结果。
--
-- 平台 SQL 校验要求表名不带 schema 前缀（按当前租户 search_path 建表），
-- 且会拦截 COMMENT ON 语句；因此本迁移不使用 public. 前缀，表说明放在这里。
create table case_answer_keys (
  case_id text not null,
  version text not null check (version ~ '^[a-f0-9]{16}$'),
  status text not null check (status in ('auto', 'not_assessable')),
  key_json jsonb,
  model text not null,
  prompt_version text not null,
  source_fingerprint text not null,
  reason text,
  dropped jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (case_id, version),
  constraint case_answer_keys_status_payload check (
    (status = 'auto' and key_json is not null)
    or (status = 'not_assessable' and key_json is null)
  )
);

alter table case_answer_keys enable row level security;

-- 教师可读（后续做抽查/改判界面用）；写入只走服务端 service role。
-- 学生没有任何直读权限；报告只下发判分结果，不下发 key_json。
grant select on case_answer_keys to authenticated;

create policy case_answer_keys_teacher_select on case_answer_keys
  for select to authenticated
  using (app_is_teacher());