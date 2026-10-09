-- 教师使用统计专项复核修复（2026-10-13）
-- 背景：8 项统计口径与安全缺口复核（真实 DB 取证），本迁移修复其中 DB 侧问题：
--   ①日期时区：DB TimeZone=UTC，原 p_from_date::timestamptz 按 UTC 0 点截断，北京时间 0-8 点会话归属错日；
--     现统一口径：统计按北京时间（Asia/Shanghai）自然日，from 边界 = p_from_date::timestamp - 8h，
--     to 边界（含当日全天）= (p_to_date+1)::timestamp - 8h；日/周趋势分日同理 started_at + 8h 后取自然日/周。
--     新增 from > to 校验（INVALID_DATE_RANGE）；非法日期由 API 层 zod 校验拒绝（RPC 侧不重复）。
--   ①跨日截断分摊：activeHours 由"区间全量按 started_at 归属"改为按筛选边界裁剪
--     （greatest(started_at, from) .. least(ended_at, to)），跨日区间按重叠秒数分摊到每日统计。
--   ②caseId 筛选对有效时长不生效：per_student / overall 的 activeHours 子查询补 case 条件
--     （无会话归属的区间在 caseId 筛选时保守排除）；case_distribution 补 p_case_id 参数（签名变更）。
--   ③abandoned 口径：原 status='active' 全部计为"中途退出"，包含进行中会话。现语义：
--     completed = 已完成；in_progress = active 且 2 小时内有更新（时间客观口径，无需人工判定）；
--     abandoned = active 且停滞超 2 小时（或已过期）。不改历史数据，仅改派生口径。
--   ④心跳归并失效：客户端 30s 心跳 > 原 10s 区间 + 5s 归并窗口，每次心跳都新开 10s 区间
--     （实测 sum=30s/max=10s，时长系统性低估）。归并窗口扩至 45s（30s 心跳 + 15s 网络抖动余量）；
--     同时单区间封顶 3600s（防异常客户端无界续期）。多标签由浏览器 visibility 语义天然去重
--     （非当前标签不发心跳、隐藏即 idle），多浏览器窗口并行区间如实累计并在文档中说明口径。
--   ⑤detail 白名单：engagement_record_event 服务端校验 detail 仅允许 path 键、值长度 <= 256，
--     非法键/超长直接拒绝（INVALID_DETAIL），杜绝夹带患者原文/token 等任意内容入库。
--   ⑥测试/演示账号隔离：profiles 新增 account_kind（real/test/unknown，默认 unknown=历史无法判定）。
--     统计 RPC 排除 'test'（E2E/联调/探针账号，受控标记而非名字前缀）；'unknown' 如实包含并输出标记，
--     由页面展示"未验证"徽标。预览演示身份不入库（route 层已有隔离）。
--   ⑧补齐：teacher_stats_weekly_trend（周活）、teacher_stats_weak_areas（题库薄弱项：正确率聚合）、
--     teacher_stats_recent_sessions（单学生逐次训练下钻，受限明细）。
-- 边界：不修改历史迁移文件；不放宽 RLS；教师判定继续复用 app_is_teacher 白名单（不改）。
-- 注：平台 SQL 守卫禁止 SECURITY DEFINER 函数内 SET search_path，函数体表名/函数名一律不带 schema 前缀
--   （与 20261011100000 / 20261010130000 同模式）。

begin;

-- ============ ⑥ 账号隔离标记 ============
alter table profiles add column if not exists account_kind text not null default 'unknown';

alter table profiles drop constraint if exists profiles_account_kind_check;
alter table profiles add constraint profiles_account_kind_check check (account_kind in ('real', 'test', 'unknown'));

-- 历史可判定的测试/联调账号：受控标记（非名字前缀，而是明确的列值）
update profiles set account_kind = 'test'
where app_role = 'student'
  and account_kind = 'unknown'
  and (
    display_name like '统计探针A%'
    or display_name in ('dbg', 'routeB', 'E2E测试学员', 'quiz-test')
  );
-- 其余历史学生账号保持 'unknown'（无法判定，如实标记，页面展示未验证徽标）
-- 新注册学生 profiles 引导（report_side_effects_save）沿用列默认值 'unknown'，
-- 不自动标记 'real'（注册来源无法在 DB 侧可靠判定为真人，自动标记反而引入误判）；
-- 如需确认为真实学生，由管理员通过受控 UPDATE 将 account_kind 置为 'real'（本迁移不引入该写路径）。

-- ============ ④⑤ 上报 RPC：心跳归并窗口修复 + detail 白名单 + 区间封顶 ============
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
  v_end timestamptz;
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
  -- ⑤detail 白名单：仅允许 path 键且值长度 <= 256（拒绝任意夹带内容）
  if p_detail is not null then
    if exists (select 1 from jsonb_object_keys(p_detail) k where k <> 'path') then
      raise exception 'INVALID_DETAIL' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each_text(p_detail) where length(value) > 256) then
      raise exception 'INVALID_DETAIL' using errcode = '22023';
    end if;
  end if;
  -- 会话归属校验：不能把事件挂到他人会话（无会话事件为 null，跳过）
  if p_session_id is not null and not exists (
    select 1 from training_sessions where id = p_session_id and user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into student_engagement_events (user_id, session_id, event_type, occurred_at, client_event_id, session_tab_id, detail)
  values (auth.uid(), p_session_id, p_event_type, v_now, p_client_event_id, p_tab_id, coalesce(p_detail, '{}'::jsonb))
  on conflict (user_id, client_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    return false;  -- 幂等命中：重复上报不双计
  end if;

  if p_event_type in ('visibility_active', 'page_enter', 'session_start', 'heartbeat') then
    -- ④归并窗口 45 秒：覆盖 30 秒心跳间隔 + 15 秒网络抖动余量
    select ai.id, ai.started_at, ai.ended_at
      into v_open
      from student_active_intervals ai
      where ai.user_id = auth.uid() and ai.tab_id = p_tab_id
        and v_now <= ai.ended_at + interval '45 seconds'
      order by ai.ended_at desc
      limit 1;

    if v_open.id is not null then
      -- ④单区间封顶 3600 秒：异常客户端无界续期时强制截断（挂机类异常保护）
      v_end := least(greatest(v_open.ended_at, v_now), v_open.started_at + interval '3600 seconds');
      update student_active_intervals
        set ended_at = v_end,
            duration_seconds = greatest(0, extract(epoch from (v_end - v_open.started_at))::int)
        where id = v_open.id;
    else
      insert into student_active_intervals (user_id, session_id, tab_id, started_at, ended_at, duration_seconds, source_event_id)
      values (auth.uid(), p_session_id, p_tab_id, v_now, v_now + interval '10 seconds', 10, v_id);
    end if;
  end if;

  return true;
end;
$$;

revoke all on function engagement_record_event(text, uuid, text, text, jsonb) from public, anon;
grant execute on function engagement_record_event(text, uuid, text, text, jsonb) to authenticated;

-- ============ ①②③⑥ 教师统计 RPC 重建 ============
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
declare
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- ①起止顺序校验 + 北京时间边界
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;
  v_from_ts := p_from_date::timestamp - interval '8 hours';   -- 北京 from 日 00:00 = UTC 前日 16:00
  v_to_ts := (p_to_date + 1)::timestamp - interval '8 hours'; -- 北京 to+1 日 00:00（含 to 全天）

  return coalesce(jsonb_agg(t order by t."displayName"), '[]'::jsonb)
  from (
    select
      p.id as "userId",
      p.display_name as "displayName",
      coalesce(p.student_no, '') as "studentNo",
      p.account_kind as "accountKind",
      count(distinct ts.id)::int as "sessionCount",
      count(distinct ts.id) filter (where ts.status = 'completed')::int as "completedCount",
      count(distinct ts.id) filter (where ts.status = 'active' and ts.updated_at < now() - interval '2 hours')::int as "abandonedCount",
      count(distinct ts.id) filter (where ts.status = 'active' and ts.updated_at >= now() - interval '2 hours')::int as "inProgressCount",
      coalesce(sum(m.turn_count), 0)::int as "turnCount",
      coalesce((
        -- ①②时长按筛选边界裁剪分摊；caseId 筛选时排除无会话归属区间
        select round(sum(greatest(0, extract(epoch from (
          least(ai.ended_at, coalesce(v_to_ts, ai.ended_at)) - greatest(ai.started_at, coalesce(v_from_ts, ai.started_at))
        )))) / 3600.0, 1)
        from student_active_intervals ai
        where ai.user_id = p.id
          and (v_from_ts is null or ai.started_at < v_to_ts)
          and (v_to_ts is null or ai.ended_at > v_from_ts)
          and (
            p_case_id is null
            or (ai.session_id is not null and exists (
              select 1 from training_sessions tsx where tsx.id = ai.session_id and tsx.case_id = p_case_id
            ))
          )
      ), 0)::numeric as "activeHours",
      coalesce((
        select round(avg(r.total_score), 1)
        from training_reports r
        where r.user_id = p.id
          and (p_case_id is null or r.case_id = p_case_id)
          and (v_from_ts is null or r.created_at >= v_from_ts)
          and (v_to_ts is null or r.created_at < v_to_ts)
      ), 0)::numeric as "avgPracticeScore"
    from profiles p
    left join training_sessions ts
      on ts.user_id = p.id
     and (v_from_ts is null or ts.started_at >= v_from_ts)
     and (v_to_ts is null or ts.started_at < v_to_ts)
     and (p_case_id is null or ts.case_id = p_case_id)
    left join (
      select session_id, count(*) as turn_count
      from training_messages
      group by session_id
    ) m on m.session_id = ts.id
    where (p_user_id is null or p.id = p_user_id)
      and p.app_role = 'student'
      and p.account_kind <> 'test'
    group by p.id, p.display_name, p.student_no, p.account_kind
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
declare
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;
  v_from_ts := p_from_date::timestamp - interval '8 hours';
  v_to_ts := (p_to_date + 1)::timestamp - interval '8 hours';

  return jsonb_build_object(
    'studentCount', (select count(distinct ts.user_id) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test'
      where (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'sessionCount', (select count(*) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test'
      where (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'completedCount', (select count(*) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test'
      where ts.status = 'completed'
        and (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'inProgressCount', (select count(*) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test'
      where ts.status = 'active' and ts.updated_at >= now() - interval '2 hours'
        and (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'totalTurnCount', coalesce((
      select sum(m.turn_count)
      from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test'
      join (
        select session_id, count(*) as turn_count
        from training_messages
        group by session_id
      ) m on m.session_id = ts.id
      where (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id)
    ), 0)::int,
    'totalActiveHours', coalesce((
      -- ①②边界裁剪分摊 + caseId 条件（与 per_student 同口径）
      select round(sum(greatest(0, extract(epoch from (
        least(ai.ended_at, coalesce(v_to_ts, ai.ended_at)) - greatest(ai.started_at, coalesce(v_from_ts, ai.started_at))
      )))) / 3600.0, 1)
      from student_active_intervals ai
      join profiles p2 on p2.id = ai.user_id and p2.app_role = 'student' and p2.account_kind <> 'test'
      where (v_from_ts is null or ai.started_at < v_to_ts)
        and (v_to_ts is null or ai.ended_at > v_from_ts)
        and (p_user_id is null or ai.user_id = p_user_id)
        and (
          p_case_id is null
          or (ai.session_id is not null and exists (
            select 1 from training_sessions tsx where tsx.id = ai.session_id and tsx.case_id = p_case_id
          ))
        )
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
declare
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;
  v_from_ts := p_from_date::timestamp - interval '8 hours';
  v_to_ts := (p_to_date + 1)::timestamp - interval '8 hours';

  return coalesce(jsonb_agg(t order by t."date"), '[]'::jsonb)
  from (
    select
      -- ①北京时间自然日分桶
      to_char(ts.started_at + interval '8 hours', 'YYYY-MM-DD') as "date",
      count(distinct ts.user_id)::int as "activeStudents",
      count(ts.id)::int as "sessions"
    from training_sessions ts
    join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test'
    where (v_from_ts is null or ts.started_at >= v_from_ts)
      and (v_to_ts is null or ts.started_at < v_to_ts)
      and (p_user_id is null or ts.user_id = p_user_id)
      and (p_case_id is null or ts.case_id = p_case_id)
    group by 1
  ) t;
end;
$$;

revoke all on function teacher_stats_daily_trend(date, date, uuid, text) from public, anon;
grant execute on function teacher_stats_daily_trend(date, date, uuid, text) to authenticated;

-- ②case_distribution 签名变更（补 p_case_id）：先 drop 旧重载避免歧义
drop function if exists teacher_stats_case_distribution(date, date, uuid);

create or replace function teacher_stats_case_distribution(
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
declare
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;
  v_from_ts := p_from_date::timestamp - interval '8 hours';
  v_to_ts := (p_to_date + 1)::timestamp - interval '8 hours';

  return coalesce(jsonb_agg(t order by t."caseId"), '[]'::jsonb)
  from (
    select
      coalesce(ts.case_id, '(未指定)') as "caseId",
      ts.mode as "mode",
      count(*)::int as "sessionCount",
      count(*) filter (where ts.status = 'completed')::int as "completedCount"
    from training_sessions ts
    join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test'
    where (v_from_ts is null or ts.started_at >= v_from_ts)
      and (v_to_ts is null or ts.started_at < v_to_ts)
      and (p_user_id is null or ts.user_id = p_user_id)
      and (p_case_id is null or ts.case_id = p_case_id)
    group by 1, 2
  ) t;
end;
$$;

revoke all on function teacher_stats_case_distribution(date, date, uuid, text) from public, anon;
grant execute on function teacher_stats_case_distribution(date, date, uuid, text) to authenticated;

-- ============ ⑧ 新增：周活趋势 ============
create or replace function teacher_stats_weekly_trend(
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
declare
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;
  v_from_ts := p_from_date::timestamp - interval '8 hours';
  v_to_ts := (p_to_date + 1)::timestamp - interval '8 hours';

  return coalesce(jsonb_agg(t order by t."week"), '[]'::jsonb)
  from (
    select
      -- ①北京时间自然周（ISO 周，周一起始）
      to_char(date_trunc('week', ts.started_at + interval '8 hours')::date, 'YYYY-MM-DD') as "week",
      count(distinct ts.user_id)::int as "activeStudents",
      count(ts.id)::int as "sessions"
    from training_sessions ts
    join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test'
    where (v_from_ts is null or ts.started_at >= v_from_ts)
      and (v_to_ts is null or ts.started_at < v_to_ts)
      and (p_user_id is null or ts.user_id = p_user_id)
      and (p_case_id is null or ts.case_id = p_case_id)
    group by 1
  ) t;
end;
$$;

revoke all on function teacher_stats_weekly_trend(date, date, uuid, text) from public, anon;
grant execute on function teacher_stats_weekly_trend(date, date, uuid, text) to authenticated;

-- ============ ⑧ 新增：题库薄弱项（正确率聚合，按病例+难度） ============
create or replace function teacher_stats_weak_areas(
  p_from_date date default null,
  p_to_date date default null,
  p_user_id uuid default null,
  p_min_samples integer default 3
)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_min integer := greatest(coalesce(p_min_samples, 3), 1);
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;
  v_from_ts := p_from_date::timestamp - interval '8 hours';
  v_to_ts := (p_to_date + 1)::timestamp - interval '8 hours';

  return coalesce(jsonb_agg(t order by t."correctRate" asc, t."assigned" desc), '[]'::jsonb)
  from (
    select
      coalesce(q.case_id, '(未指定)') as "caseId",
      coalesce(q.difficulty, 'unknown') as "difficulty",
      count(*)::int as "assigned",
      count(*) filter (where qa.is_correct)::int as "correct",
      round(count(*) filter (where qa.is_correct)::numeric / count(*), 2)::numeric as "correctRate"
    from quiz_assignments qa
    join quiz_questions q on q.id = qa.question_id
    join profiles p on p.id = qa.user_id and p.app_role = 'student' and p.account_kind <> 'test'
    where qa.answered_at is not null
      and (v_from_ts is null or qa.assigned_at >= v_from_ts)
      and (v_to_ts is null or qa.assigned_at < v_to_ts)
      and (p_user_id is null or qa.user_id = p_user_id)
    group by 1, 2
    having count(*) >= v_min
    -- 薄弱项：正确率 < 0.8 才值得教师关注
    and count(*) filter (where qa.is_correct)::numeric / count(*) < 0.8
  ) t;
end;
$$;

revoke all on function teacher_stats_weak_areas(date, date, uuid, integer) from public, anon;
grant execute on function teacher_stats_weak_areas(date, date, uuid, integer) to authenticated;

-- ============ ⑧ 新增：单学生逐次训练明细下钻（受限明细，需指定学生） ============
create or replace function teacher_stats_recent_sessions(
  p_user_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  if not exists (select 1 from profiles p where p.id = p_user_id and p.app_role = 'student') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return coalesce(jsonb_agg(t order by t."startedAt" desc), '[]'::jsonb)
  from (
    select
      ts.id as "sessionId",
      coalesce(ts.case_id, '(未指定)') as "caseId",
      ts.mode as "mode",
      case
        when ts.status = 'completed' then 'completed'
        when ts.status = 'active' and ts.updated_at < now() - interval '2 hours' then 'abandoned'
        else 'in_progress'
      end as "statusKind",
      to_char(ts.started_at + interval '8 hours', 'YYYY-MM-DD HH24:MI') as "startedAt",
      coalesce(m.turn_count, 0)::int as "turnCount",
      coalesce(r.total_score, 0)::int as "practiceScore"
    from training_sessions ts
    left join (
      select session_id, count(*) as turn_count
      from training_messages
      group by session_id
    ) m on m.session_id = ts.id
    left join training_reports r on r.session_id = ts.id
    where ts.user_id = p_user_id
    limit v_limit
  ) t;
end;
$$;

revoke all on function teacher_stats_recent_sessions(uuid, integer) from public, anon;
grant execute on function teacher_stats_recent_sessions(uuid, integer) to authenticated;

commit;
