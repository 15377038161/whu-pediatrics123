-- 病例分析标答（B6 接线第 0 步）
-- 一条记录对应「病例 + 内容指纹」的一份五段评分点：
--   status = 'auto'           AI 从原件生成并通过自动原文回校，可用于判分
--   status = 'not_assessable' 生成/回校失败，不产出标答；调用方必须回退过程分并明确标注
-- 学生不直读本表：标答只在服务端判分时使用，报告只下发逐点命中/漏项结果。
create table public.case_answer_keys (
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

alter table public.case_answer_keys enable row level security;

-- 教师可读（后续做抽查/改判界面用）；写入只走服务端 service role，不开放 authenticated 写策略。
create policy case_answer_keys_teacher_select on public.case_answer_keys
  for select to authenticated
  using (app_is_teacher());

comment on table public.case_answer_keys is
  '病例分析标答：AI 从原始病例生成、经原文回校后按 case_id + 内容指纹缓存；学生不直读，判分结果随报告下发。';
comment on column public.case_answer_keys.key_json is
  '五段标答 JSON（primary/secondary/evidence/differentials/management）；not_assessable 时必须为 null。';
comment on column public.case_answer_keys.dropped is
  '被自动质量闸门丢弃的候选及原因，供追溯；不影响已通过的得分点。';