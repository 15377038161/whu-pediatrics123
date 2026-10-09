-- 教师学生使用统计（2026-10-11 最小实现）
-- 目标：服务端真实身份/时间记录学习活跃事件，支撑教师统计（明细+聚合）与有效时长口径。
-- 边界：不改历史迁移；不改教师白名单/RLS 教师范围；不含患者原文/token；学生仅能上报本人事件。
-- 实况对齐（执行前经 pg_proc/pg_class 核实）：教师判定函数为 app_is_teacher()（teacher_emails 白名单，
--   SECURITY DEFINER，无 app schema）；training_sessions.id 为 uuid；历史 RLS 教师策略均用 app_is_teacher()。
-- 注：平台 SQL 守卫禁止 SECURITY DEFINER 函数内 SET search_path，函数体表名/函数名一律不带 schema 前缀
--   （与 20261010130000_reference_teacher_only.sql 同模式）。
-- 测试/演示分离：RLS 探针与联调账号无 profiles 行（或非 student 角色），统计一律 join profiles 学生过滤，
--   天然排除测试数据；预览演示身份走进程内存不入库，与真实数据天然分离。

begin;

-- 1) 学生学习事件（auth 行为埋点：页面进入/离开、激活/切后台、心跳、训练开始/结束）
--    客户端只上报事件（client_event_id 幂等键），时长结论一律由服务端派生，学生无直插权限。
create table student_engagement_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  session_id uuid references training_sessions(id) on delete set null,  -- 无训练会话的页面进入/离开为 null
  event_type text not null check (event_type in ('session_start','session_end','page_enter','page_leave','visibility_active','visibility_idle','heartbeat')),
  source text not null default 'browser',
  occurred_at timestamptz not null,  -- 服务端接收时间（统一口径：不信任客户端时钟）
  client_event_id text not null,     -- 客户端生成的去重键（幂等：同一事件重复上报只计一次）
  session_tab_id text not null,      -- 同一浏览器多标签区分（多标签去重依据）
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create index student_engagement_user_time_idx on student_engagement_events(user_id, occurred_at desc);
create index student_engagement_session_idx on student_engagement_events(session_id, occurred_at desc);

alter table student_engagement_events enable row level security;
-- 只读：本人或教师（复用既有 app_is_teacher 白名单语义，与 training_sessions 教师读权限一致）
create policy engagement_self_read on student_engagement_events for select to authenticated
  using (user_id = auth.uid() or app_is_teacher());
-- 学生无 INSERT 策略：事件必须经受控 RPC engagement_record_event（归属强制 + 幂等 + 派生区间）

grant select on student_engagement_events to authenticated;

-- 2) 有效活跃区间（服务端派生；隐藏页/多标签非当前页/挂机不计入）
--    口径：visibility_active/page_enter/session_start/heartbeat 开区间（默认 10 秒），
--    同标签页 5 秒内的后续活跃事件归并续期；visibility_idle/page_leave 之前的区间自然截止。
create table student_active_intervals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  session_id uuid,
  tab_id text not null,             -- 派生自 session_tab_id：同一标签页的活跃区间串
  started_at timestamptz not null,  -- 区间起点 = 本标签页上一活跃事件时间
  ended_at timestamptz not null,    -- 区间终点 = 归并续期后的最后活跃事件时间
  duration_seconds integer not null check (duration_seconds >= 0),
  source_event_id uuid not null references student_engagement_events(id) on delete cascade
);

create index student_active_user_time_idx on student_active_intervals(user_id, started_at desc);
create index student_active_session_idx on student_active_intervals(session_id, started_at desc);

alter table student_active_intervals enable row level security;
create policy active_intervals_read on student_active_intervals for select to authenticated
  using (user_id = auth.uid() or app_is_teacher());
-- 无 INSERT/UPDATE 策略：区间只能由 engagement_record_event（SECURITY DEFINER）派生

grant select on student_active_intervals to authenticated;

-- 3) 受控事件上报 RPC：归属强制（auth.uid()）、服务端时间、幂等去重、派生/续期有效区间
create or replace function engagement_record_event(
  p_event_type text,
  p_session_id uuid,
  p_client_event_id text,
  p_tab_id text,
  p_detail jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
  v_open record;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_client_event_id is null or length(p_client_event_id) < 8 or length(p_client_event_id) > 128 then
    raise exception 'INVALID_EVENT_ID' using errcode = '22023';
  end if;
  if p_tab_id is null or length(p_tab_id) < 8 or length(p_tab_id) > 128 then
    raise exception 'INVALID_TAB_ID' using errcode = '22023';
  end if;
  -- 会话归属校验：不能把事件挂到他人会话（page_enter 等无会话事件为 null，跳过）
  if p_session_id is not null and not exists (
    select 1 from training_sessions where id = p_session_id and user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- 有效时长口径只依赖服务端接收时间；客户端时间仅存 detail 供排障，不参与计算
  insert into student_engagement_events (user_id, session_id, event_type, occurred_at, client_event_id, session_tab_id, detail)
  values (auth.uid(), p_session_id, p_event_type, v_now, p_client_event_id, p_tab_id, coalesce(p_detail, '{}'::jsonb))
  on conflict (user_id, client_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    return false;  -- 幂等命中：重复上报不双计
  end if;

  -- 活跃类事件才驱动区间（idle/leave/end 不驱动）
  if p_event_type in ('visibility_active', 'page_enter', 'session_start', 'heartbeat') then
    -- 同标签页存在 5 秒内可归并的区间 → 续期（容忍网络抖动）
    select ai.id, ai.ended_at, ai.started_at
      into v_open
      from student_active_intervals ai
      where ai.user_id = auth.uid() and ai.tab_id = p_tab_id
        and v_now <= ai.ended_at + interval '5 seconds'
      order by ai.ended_at desc
      limit 1;

    if v_open.id is not null then
      update student_active_intervals
        set ended_at = greatest(ended_at, v_now),
            duration_seconds = greatest(0, extract(epoch from (greatest(ended_at, v_now) - started_at))::int)
        where id = v_open.id;
    else
      -- 新开区间：默认 10 秒最小活跃单元，等待后续心跳/活跃事件续期
      insert into student_active_intervals (user_id, session_id, tab_id, started_at, ended_at, duration_seconds, source_event_id)
      values (auth.uid(), p_session_id, p_tab_id, v_now, v_now + interval '10 seconds', 10, v_id);
    end if;
  end if;

  return true;
end;
$$;

revoke all on function engagement_record_event(text, uuid, text, text, jsonb) from public, anon;
grant execute on function engagement_record_event(text, uuid, text, text, jsonb) to authenticated;

-- 4) 教师统计 RPC（按块拆分为 4 个小函数，每个均带 app_is_teacher 白名单守卫；学生/匿名调用直接异常 → 路由层 403）
--    统计口径：仅统计有 profiles 行且 app_role='student' 的真实学生（RLS 探针/联调账号无 profile 或为教师角色，天然排除）
create or replace function teacher_stats_per_student(
  p_from_date date default null,
  p_to_date date default null,
  p_user_id uuid default null,
  p_case_id text default null
)
returns jsonb
language plpgsql
stable
security definer
as $$
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return coalesce(jsonb_agg(t order by t."displayName"), '[]'::jsonb)
  from (
    select
      p.id as "userId",
      p.display_name as "displayName",
      coalesce(p.student_no, '') as "studentNo",
      count(distinct ts.id)::int as "sessionCount",
      count(distinct ts.id) filter (where ts.status = 'completed')::int as "completedCount",
      count(distinct ts.id) filter (where ts.status = 'active')::int as "abandonedCount",
      coalesce(sum(m.turn_count), 0)::int as "turnCount",
      coalesce((
        select round(sum(ai.duration_seconds) / 3600.0, 1)
        from student_active_intervals ai
        where ai.user_id = p.id
          and (p_from_date is null or ai.started_at >= p_from_date::timestamptz)
          and (p_to_date is null or ai.started_at < (p_to_date + 1)::timestamptz)
      ), 0)::numeric as "activeHours",
      coalesce((
        select round(avg(r.total_score), 1)
        from training_reports r
        where r.user_id = p.id
          and (p_case_id is null or r.case_id = p_case_id)
          and (p_from_date is null or r.created_at >= p_from_date::timestamptz)
          and (p_to_date is null or r.created_at < (p_to_date + 1)::timestamptz)
      ), 0)::numeric as "avgPracticeScore"
    from profiles p
    left join training_sessions ts
      on ts.user_id = p.id
     and (p_from_date is null or ts.started_at >= p_from_date::timestamptz)
     and (p_to_date is null or ts.started_at < (p_to_date + 1)::timestamptz)
     and (p_case_id is null or ts.case_id = p_case_id)
    left join (
      select session_id, count(*) as turn_count
      from training_messages
      group by session_id
    ) m on m.session_id = ts.id
    where (p_user_id is null or p.id = p_user_id)
      and p.app_role = 'student'
    group by p.id, p.display_name, p.student_no
  ) t;
end;
$$;

revoke all on function teacher_stats_per_student(date, date, uuid, text) from public, anon;
grant execute on function teacher_stats_per_student(date, date, uuid, text) to authenticated;

create or replace function teacher_stats_overall(
  p_from_date date default null,
  p_to_date date default null,
  p_user_id uuid default null,
  p_case_id text default null
)
returns jsonb
language plpgsql
stable
security definer
as $$
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'studentCount', (select count(distinct ts.user_id) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student'
      where (p_from_date is null or ts.started_at >= p_from_date::timestamptz)
        and (p_to_date is null or ts.started_at < (p_to_date + 1)::timestamptz)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'sessionCount', (select count(*) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student'
      where (p_from_date is null or ts.started_at >= p_from_date::timestamptz)
        and (p_to_date is null or ts.started_at < (p_to_date + 1)::timestamptz)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'completedCount', (select count(*) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student'
      where ts.status = 'completed'
        and (p_from_date is null or ts.started_at >= p_from_date::timestamptz)
        and (p_to_date is null or ts.started_at < (p_to_date + 1)::timestamptz)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'totalTurnCount', coalesce((
      select sum(m.turn_count)
      from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student'
      join (
        select session_id, count(*) as turn_count
        from training_messages
        group by session_id
      ) m on m.session_id = ts.id
      where (p_from_date is null or ts.started_at >= p_from_date::timestamptz)
        and (p_to_date is null or ts.started_at < (p_to_date + 1)::timestamptz)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id)
    ), 0)::int,
    'totalActiveHours', coalesce((
      select round(sum(ai.duration_seconds) / 3600.0, 1)
      from student_active_intervals ai
      join profiles p2 on p2.id = ai.user_id and p2.app_role = 'student'
      where (p_from_date is null or ai.started_at >= p_from_date::timestamptz)
        and (p_to_date is null or ai.started_at < (p_to_date + 1)::timestamptz)
        and (p_user_id is null or ai.user_id = p_user_id)
    ), 0)::numeric
  );
end;
$$;

revoke all on function teacher_stats_overall(date, date, uuid, text) from public, anon;
grant execute on function teacher_stats_overall(date, date, uuid, text) to authenticated;

create or replace function teacher_stats_daily_trend(
  p_from_date date default null,
  p_to_date date default null,
  p_user_id uuid default null,
  p_case_id text default null
)
returns jsonb
language plpgsql
stable
security definer
as $$
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return coalesce(jsonb_agg(t order by t."date"), '[]'::jsonb)
  from (
    select
      to_char(ts.started_at, 'YYYY-MM-DD') as "date",
      count(distinct ts.user_id)::int as "activeStudents",
      count(ts.id)::int as "sessions"
    from training_sessions ts
    join profiles p on p.id = ts.user_id and p.app_role = 'student'
    where (p_from_date is null or ts.started_at >= p_from_date::timestamptz)
      and (p_to_date is null or ts.started_at < (p_to_date + 1)::timestamptz)
      and (p_user_id is null or ts.user_id = p_user_id)
      and (p_case_id is null or ts.case_id = p_case_id)
    group by 1
  ) t;
end;
$$;

revoke all on function teacher_stats_daily_trend(date, date, uuid, text) from public, anon;
grant execute on function teacher_stats_daily_trend(date, date, uuid, text) to authenticated;

create or replace function teacher_stats_case_distribution(
  p_from_date date default null,
  p_to_date date default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
as $$
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return coalesce(jsonb_agg(t order by t."caseId"), '[]'::jsonb)
  from (
    select
      coalesce(ts.case_id, '(未指定)') as "caseId",
      ts.mode as "mode",
      count(*)::int as "sessionCount",
      count(*) filter (where ts.status = 'completed')::int as "completedCount"
    from training_sessions ts
    join profiles p on p.id = ts.user_id and p.app_role = 'student'
    where (p_from_date is null or ts.started_at >= p_from_date::timestamptz)
      and (p_to_date is null or ts.started_at < (p_to_date + 1)::timestamptz)
      and (p_user_id is null or ts.user_id = p_user_id)
    group by 1, 2
  ) t;
end;
$$;

revoke all on function teacher_stats_case_distribution(date, date, uuid) from public, anon;
grant execute on function teacher_stats_case_distribution(date, date, uuid) to authenticated;

commit;
