begin;

create extension if not exists pgcrypto;
create schema if not exists app;

create type public.app_role as enum ('student', 'teacher');
create type public.session_mode as enum ('guided', 'practice', 'osce');
create type public.session_status as enum ('active', 'completed', 'report_pending');
create type public.sync_status as enum ('pending', 'retry', 'delivered', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  student_no text,
  chaoxing_uid text unique,
  institution_fid text,
  app_role public.app_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.external_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('chaoxing')),
  provider_uid text not null,
  provider_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_uid)
);

create table public.cohorts (
  id uuid primary key,
  name text not null,
  institution_fid text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cohort_members (
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  joined_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);

create table public.cases (
  id text primary key,
  title text not null,
  subtitle text not null,
  status text not null check (status in ('draft', 'published', 'retired')),
  current_version integer not null,
  created_at timestamptz not null default now()
);

create table public.case_versions (
  case_id text not null references public.cases(id) on delete cascade,
  version integer not null,
  configuration jsonb not null,
  checksum text not null,
  published_at timestamptz,
  primary key (case_id, version)
);

create table public.training_sessions (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cohort_id uuid not null references public.cohorts(id),
  case_id text not null references public.cases(id),
  case_version integer not null,
  mode public.session_mode not null,
  stage text not null,
  status public.session_status not null,
  state jsonb not null,
  started_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz,
  foreign key (case_id, case_version) references public.case_versions(case_id, version)
);

create table public.training_messages (
  id uuid primary key,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  actor text not null,
  content text not null,
  emotion text not null,
  message_kind text not null,
  score_item_codes text[] not null default '{}',
  created_at timestamptz not null
);

create table public.clinical_operations (
  id uuid primary key,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  client_event_id text not null,
  event_type text not null,
  stage text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (session_id, client_event_id)
);

create table public.agent_call_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  client_event_id text not null,
  execution text not null check (execution in ('deterministic', 'model', 'model_fallback')),
  model_name text,
  duration_ms integer not null check (duration_ms >= 0),
  trace jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, client_event_id)
);

create table public.training_reports (
  id uuid primary key,
  session_id uuid not null unique references public.training_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  case_id text not null references public.cases(id),
  mode public.session_mode not null,
  total_score integer not null check (total_score between 0 and 100),
  data jsonb not null,
  status text not null check (status in ('ready', 'pending_review')),
  created_at timestamptz not null
);

create table public.ability_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  dimensions jsonb not null,
  recommendation jsonb not null,
  source_report_id uuid references public.training_reports(id),
  updated_at timestamptz not null default now()
);

create table public.knowledge_documents (
  id text primary key,
  title text not null,
  organization text not null,
  source_url text not null,
  published_at date,
  age_range text,
  tags text[] not null default '{}',
  source_status text not null check (source_status in ('temporary_public', 'teacher_approved', 'retired')),
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (document_id, chunk_index)
);

create table public.sync_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status public.sync_status not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.integration_audit_logs (
  id uuid primary key default gen_random_uuid(),
  integration text not null,
  action text not null,
  outcome text not null,
  reference_id text,
  safe_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index training_sessions_user_updated_idx on public.training_sessions(user_id, updated_at desc);
create index training_sessions_cohort_updated_idx on public.training_sessions(cohort_id, updated_at desc);
create index reports_user_created_idx on public.training_reports(user_id, created_at desc);
create index sync_outbox_pending_idx on public.sync_outbox(status, next_attempt_at);

create or replace function app.is_teacher_for_user(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cohort_members teacher_membership
    join public.cohort_members student_membership
      on student_membership.cohort_id = teacher_membership.cohort_id
    where teacher_membership.user_id = auth.uid()
      and teacher_membership.role = 'teacher'
      and student_membership.user_id = target_user
  );
$$;

revoke all on function app.is_teacher_for_user(uuid) from public;
grant execute on function app.is_teacher_for_user(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.external_identities enable row level security;
alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;
alter table public.cases enable row level security;
alter table public.case_versions enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_messages enable row level security;
alter table public.clinical_operations enable row level security;
alter table public.agent_call_records enable row level security;
alter table public.training_reports enable row level security;
alter table public.ability_profiles enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.sync_outbox enable row level security;
alter table public.integration_audit_logs enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_teacher_for_user(id));
create policy external_identity_self_read on public.external_identities for select to authenticated
  using (user_id = auth.uid());
create policy cohorts_member_read on public.cohorts for select to authenticated
  using (exists (select 1 from public.cohort_members cm where cm.cohort_id = id and cm.user_id = auth.uid()));
create policy memberships_related_read on public.cohort_members for select to authenticated
  using (user_id = auth.uid() or app.is_teacher_for_user(user_id));
create policy published_cases_read on public.cases for select to authenticated using (status = 'published');
create policy published_case_versions_read on public.case_versions for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id and c.status = 'published'));
create policy sessions_owner_or_teacher_read on public.training_sessions for select to authenticated
  using (user_id = auth.uid() or app.is_teacher_for_user(user_id));
create policy messages_owner_or_teacher_read on public.training_messages for select to authenticated
  using (exists (select 1 from public.training_sessions s where s.id = session_id and (s.user_id = auth.uid() or app.is_teacher_for_user(s.user_id))));
create policy operations_owner_or_teacher_read on public.clinical_operations for select to authenticated
  using (exists (select 1 from public.training_sessions s where s.id = session_id and (s.user_id = auth.uid() or app.is_teacher_for_user(s.user_id))));
create policy agent_calls_owner_or_teacher_read on public.agent_call_records for select to authenticated
  using (exists (select 1 from public.training_sessions s where s.id = session_id and (s.user_id = auth.uid() or app.is_teacher_for_user(s.user_id))));
create policy reports_owner_or_teacher_read on public.training_reports for select to authenticated
  using (user_id = auth.uid() or app.is_teacher_for_user(user_id));
create policy abilities_owner_or_teacher_read on public.ability_profiles for select to authenticated
  using (user_id = auth.uid() or app.is_teacher_for_user(user_id));
create policy approved_knowledge_read on public.knowledge_documents for select to authenticated
  using (source_status in ('temporary_public', 'teacher_approved'));
create policy approved_chunks_read on public.knowledge_chunks for select to authenticated
  using (exists (select 1 from public.knowledge_documents d where d.id = document_id and d.source_status in ('temporary_public', 'teacher_approved')));

insert into public.cohorts (id, name, institution_fid)
values ('10000000-0000-4000-8000-000000000102', '武汉大学儿科学首版课程群组', 'PENDING_WHUIT_FID')
on conflict (id) do nothing;

insert into public.cases (id, title, subtitle, status, current_version)
values ('peds-respiratory-001', '3岁患儿发热、咳嗽伴气促', '儿童呼吸系统 · 危险信号识别与家长沟通', 'published', 1)
on conflict (id) do nothing;

insert into public.case_versions (case_id, version, configuration, checksum, published_at)
values (
  'peds-respiratory-001',
  1,
  '{"source":"src/domain/case.ts","locked":true,"teacherReview":"pending"}'::jsonb,
  'FLAGSHIP_CASE_V1_SOURCE_LOCKED',
  now()
)
on conflict (case_id, version) do nothing;

commit;
