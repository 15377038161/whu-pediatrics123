begin;

-- 班级规则改造（阶段 E / W07）：首次自选、游客、名单匹配自动入班与一次换班。
-- 原则：不改历史迁移、不删既有策略/函数、不重算既有报告与历史分。
-- 1) student_class_state：学生唯一当前主班级 + onboarding 状态 + 换班次数（客户端不可直写）
-- 2) class_membership_history：归属区间审计（原班/新班/来源/生效区间/幂等 requestId），不可删除轨迹
-- 3) 受控 RPC：class_initial_select / class_skip_guest / class_change_once / class_archive
-- 4) class_sync_identity 尾部追加 class_ensure_state：名单唯一可靠匹配自动入班（不扣次数）
-- 5) class_bind_trusted_roster：已有 onboarding 状态的学生不再自动插入成员关系
-- 6) app_can_view_training：按归属期间限制教师对训练数据的可见性（方案 10.5），新增 restrictive 策略叠加收紧
-- 7) 旧学生申请—教师审批流程停用：class_request_join / class_review_request 撤销执行权限，
--    class_join_requests 表与数据保留只读。

-- ============================================================
-- 1) 新表
-- ============================================================
create table student_class_state (
  user_id uuid primary key references profiles(id) on delete cascade,
  current_cohort_id uuid references cohorts(id) on delete set null,
  onboarding_done boolean not null default false,
  self_change_count integer not null default 0 check (self_change_count >= 0),
  updated_at timestamptz not null default now()
);

create table class_membership_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  from_cohort_id uuid references cohorts(id) on delete set null,
  to_cohort_id uuid references cohorts(id) on delete set null,
  change_kind text not null check (change_kind in ('auto_match','legacy_backfill','initial_select','skip_guest','change_once')),
  request_id text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now()
);

-- 同一学生的同一幂等请求只允许一条审计记录（重复提交不重复执行、不重复扣次数）
create unique index class_membership_history_request_uk on class_membership_history(user_id, request_id) where request_id is not null;
create index class_membership_history_user_idx on class_membership_history(user_id, effective_from desc);

alter table student_class_state enable row level security;
alter table class_membership_history enable row level security;

-- 写入只能经 SECURITY DEFINER 受控 RPC；不授予 insert/update/delete
revoke all on student_class_state, class_membership_history from public, anon, authenticated;
grant select on student_class_state, class_membership_history to authenticated;

create policy class_state_read on student_class_state for select to authenticated using (user_id = auth.uid());
create policy membership_history_read on class_membership_history for select to authenticated
  using (user_id = auth.uid() or app_manages_class(from_cohort_id) or app_manages_class(to_cohort_id));

-- ============================================================
-- 2) 旧成员固化（一次性回填，不动多班冲突学生）
--    恰好归属一个正式班级（owner_id 非空）的旧成员生成状态与开放历史区间；
--    多班冲突学生不回填，保留候选待核对，经首次选班裁决或项目管理员受控处理。
-- ============================================================
insert into student_class_state (user_id, current_cohort_id, onboarding_done)
select t.user_id, t.cohort_id, true
from (
  select m.user_id, m.cohort_id,
         count(*) over (partition by m.user_id) as cnt
  from cohort_members m
  where m.role = 'student'
    and exists (select 1 from cohorts c where c.id = m.cohort_id and c.owner_id is not null)
) t
where t.cnt = 1;

insert into class_membership_history (user_id, from_cohort_id, to_cohort_id, change_kind, effective_from)
select s.user_id, null, s.current_cohort_id, 'legacy_backfill', '-infinity'::timestamptz
from student_class_state s;

-- ============================================================
-- 3) 归属期间判定与教师可见范围（方案 10.5）
-- ============================================================
-- 学生在某时刻是否归属某班级：有历史区间按区间判定；无区间记录（旧数据/冲突待核对）
-- 回退到当前成员关系（保持既有教师可见口径，不做追溯改写）。
create or replace function app_member_at(p_user_id uuid, p_cohort_id uuid, p_at timestamptz)
returns boolean language sql stable security definer as $$
  select case
    when exists (select 1 from class_membership_history where user_id = p_user_id) then
      exists (
        select 1 from class_membership_history h
        where h.user_id = p_user_id
          and h.to_cohort_id = p_cohort_id
          and h.effective_from <= p_at
          and (h.effective_to is null or h.effective_to > p_at)
      )
    else
      exists (
        select 1 from cohort_members m
        where m.user_id = p_user_id and m.cohort_id = p_cohort_id and m.role = 'student'
      )
  end;
$$;

-- 教师可见训练数据的统一口径：本人直通；项目管理员直通；任课教师仅可见
-- 学生归属其管理的启用班级期间产生的训练。p_cohort_id 为签名预留参数
--（当前训练会话统一挂在默认班级，判断以归属期间为准，不依赖会话班级列）。
create or replace function app_can_view_training(p_user_id uuid, p_cohort_id uuid default null, p_created_at timestamptz default now())
returns boolean language sql stable security definer as $$
  select p_user_id = auth.uid()
    or (app_is_teacher() and app_is_project_admin())
    or (app_is_teacher() and exists (
      select 1 from cohorts c
      where c.owner_id = auth.uid()
        and c.is_active::text in ('true','1')
        and app_member_at(p_user_id, c.id, coalesce(p_created_at, now()))
    ));
$$;

-- restrictive 叠加策略：不删既有策略，在其上按归属期间进一步收紧教师读取。
create policy class_period_training_sessions on training_sessions as restrictive for select to authenticated
  using (user_id = auth.uid() or app_can_view_training(user_id, cohort_id, started_at));

create policy class_period_training_reports on training_reports as restrictive for select to authenticated
  using (user_id = auth.uid() or app_can_view_training(user_id, null, created_at));

create policy class_period_training_messages on training_messages as restrictive for select to authenticated
  using (exists (select 1 from training_sessions s where s.id = session_id and (s.user_id = auth.uid() or app_can_view_training(s.user_id, s.cohort_id, s.started_at))));

create policy class_period_clinical_operations on clinical_operations as restrictive for select to authenticated
  using (exists (select 1 from training_sessions s where s.id = session_id and (s.user_id = auth.uid() or app_can_view_training(s.user_id, s.cohort_id, s.started_at))));

create policy class_period_agent_call_records on agent_call_records as restrictive for select to authenticated
  using (exists (select 1 from training_sessions s where s.id = session_id and (s.user_id = auth.uid() or app_can_view_training(s.user_id, s.cohort_id, s.started_at))));

create policy class_period_student_engagement_events on student_engagement_events as restrictive for select to authenticated
  using (user_id = auth.uid() or app_can_view_training(user_id, null, occurred_at));

create policy class_period_student_active_intervals on student_active_intervals as restrictive for select to authenticated
  using (user_id = auth.uid() or app_can_view_training(user_id, null, started_at));

-- 未作答的分配记录不携带时间锚点，维持既有教师可见；已作答记录按归属期间收紧
create policy class_period_quiz_assignments on quiz_assignments as restrictive for select to authenticated
  using (user_id = auth.uid() or app_can_view_training(user_id, null, coalesce(answered_at, now())));

-- ============================================================
-- 4) 状态投影与受控 RPC
-- ============================================================
create or replace function class_state_json(p_user uuid) returns jsonb
language sql stable security definer as $$
  select coalesce((
    select jsonb_build_object('currentCohortId', s.current_cohort_id, 'onboardingDone', s.onboarding_done,
      'selfChangeCount', s.self_change_count, 'changesRemaining', greatest(0, 1 - s.self_change_count))
    from student_class_state s where s.user_id = p_user
  ), jsonb_build_object('currentCohortId', null, 'onboardingDone', false, 'selfChangeCount', 0, 'changesRemaining', 1));
$$;

-- 名单唯一可靠匹配自动入班：登录身份同步后调用；仅在学生恰好归属一个正式班级
-- 且尚无 onboarding 状态时固化归属（kind=auto_match，不扣换班次数）。
-- 多班同时命中不自动归班（候选待核对，学生经首次选班裁决）。
create or replace function class_ensure_state() returns void
language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_cohort uuid;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if exists (select 1 from student_class_state where user_id = v_user) then return; end if;
  select cohort_id into v_cohort from cohort_members m
    where m.user_id = v_user and m.role = 'student'
      and exists (select 1 from cohorts c where c.id = m.cohort_id and c.owner_id is not null);
  if not found then return; end if;
  if (select count(*) from cohort_members m2
      where m2.user_id = v_user and m2.role = 'student'
        and exists (select 1 from cohorts c2 where c2.id = m2.cohort_id and c2.owner_id is not null)) > 1 then
    return;
  end if;
  insert into student_class_state (user_id, current_cohort_id, onboarding_done) values (v_user, v_cohort, true);
  insert into class_membership_history (user_id, from_cohort_id, to_cohort_id, change_kind, effective_from)
    values (v_user, null, v_cohort, 'auto_match', '-infinity'::timestamptz);
end;
$$;

-- 首次自选班级：无 onboarding 状态时可用；已有状态报 ALREADY_ONBOARDED；
-- 已有唯一正式班级报 ALREADY_IN_CLASS（走一次换班）；多班自动绑定冲突由学生
-- 首次明确选择裁决（清除未确认的自动成员关系，不删除名单绑定与审计）。
create or replace function class_initial_select(p_cohort_id uuid, p_request_id text default null)
returns jsonb language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_request text;
  v_count integer;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  v_request := nullif(btrim(p_request_id), '');
  if v_request is null or length(v_request) not between 8 and 64 then raise exception 'INVALID_INPUT'; end if;
  if p_cohort_id is null or not exists (
    select 1 from cohorts where id = p_cohort_id and is_active::text in ('true','1') and owner_id is not null
  ) then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext('class_onboard:' || v_user::text));
  -- 幂等：同一 requestId 重复提交返回当前状态（锁后复查，覆盖双设备并发）
  if exists (select 1 from class_membership_history where user_id = v_user and request_id = v_request) then
    return class_state_json(v_user);
  end if;
  if exists (select 1 from student_class_state where user_id = v_user) then
    raise exception 'ALREADY_ONBOARDED';
  end if;
  select count(*) into v_count from cohort_members m
    where m.user_id = v_user and m.role = 'student'
      and exists (select 1 from cohorts c where c.id = m.cohort_id and c.owner_id is not null);
  if v_count = 1 then raise exception 'ALREADY_IN_CLASS'; end if;
  if v_count > 1 then
    delete from cohort_members where user_id = v_user and role = 'student';
  end if;
  insert into cohort_members (cohort_id, user_id, role) values (p_cohort_id, v_user, 'student');
  insert into student_class_state (user_id, current_cohort_id, onboarding_done)
    values (v_user, p_cohort_id, true);
  insert into class_membership_history (user_id, from_cohort_id, to_cohort_id, change_kind, request_id, effective_from)
    values (v_user, null, p_cohort_id, 'initial_select', v_request, now());
  return class_state_json(v_user);
end;
$$;

-- 首次跳过：进入游客班级（无正式归属的逻辑分组，本人账号训练不受影响）。
create or replace function class_skip_guest(p_request_id text default null)
returns jsonb language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_request text;
  v_count integer;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  v_request := nullif(btrim(p_request_id), '');
  if v_request is null or length(v_request) not between 8 and 64 then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('class_onboard:' || v_user::text));
  if exists (select 1 from class_membership_history where user_id = v_user and request_id = v_request) then
    return class_state_json(v_user);
  end if;
  if exists (select 1 from student_class_state where user_id = v_user) then
    raise exception 'ALREADY_ONBOARDED';
  end if;
  select count(*) into v_count from cohort_members m
    where m.user_id = v_user and m.role = 'student'
      and exists (select 1 from cohorts c where c.id = m.cohort_id and c.owner_id is not null);
  if v_count = 1 then raise exception 'ALREADY_IN_CLASS'; end if;
  if v_count > 1 then
    delete from cohort_members where user_id = v_user and role = 'student';
  end if;
  insert into student_class_state (user_id, current_cohort_id, onboarding_done) values (v_user, null, true);
  insert into class_membership_history (user_id, from_cohort_id, to_cohort_id, change_kind, request_id, effective_from)
    values (v_user, null, null, 'skip_guest', v_request, now());
  return class_state_json(v_user);
end;
$$;

-- 一次自主换班：服务端事务锁 + 幂等 requestId + self_change_count<1 校验。
-- 同班不扣；成功扣一次；双设备并发最多成功一次；换班不改写既有训练记录与其班级列。
create or replace function class_change_once(p_cohort_id uuid, p_request_id text default null)
returns jsonb language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_request text;
  v_state student_class_state%rowtype;
  v_cohort uuid;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  v_request := nullif(btrim(p_request_id), '');
  if v_request is null or length(v_request) not between 8 and 64 then raise exception 'INVALID_INPUT'; end if;
  if p_cohort_id is null or not exists (
    select 1 from cohorts where id = p_cohort_id and is_active::text in ('true','1') and owner_id is not null
  ) then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext('class_onboard:' || v_user::text));
  if exists (select 1 from class_membership_history where user_id = v_user and request_id = v_request) then
    return class_state_json(v_user);
  end if;
  select * into v_state from student_class_state where user_id = v_user for update;
  if not found then
    -- 旧审批/绑定时代入班的成员首次换班：先固化唯一当前归属再走换班；
    -- 多班冲突不武断挑选，需先经首次选班裁决（候选清单留待人工核对）。
    select cohort_id into v_cohort from cohort_members m
      where m.user_id = v_user and m.role = 'student'
        and exists (select 1 from cohorts c where c.id = m.cohort_id and c.owner_id is not null);
    if not found then raise exception 'NOT_ONBOARDED'; end if;
    if (select count(*) from cohort_members m2
        where m2.user_id = v_user and m2.role = 'student'
          and exists (select 1 from cohorts c2 where c2.id = m2.cohort_id and c2.owner_id is not null)) > 1 then
      raise exception 'AMBIGUOUS_MEMBERSHIP';
    end if;
    insert into student_class_state (user_id, current_cohort_id, onboarding_done) values (v_user, v_cohort, true);
    insert into class_membership_history (user_id, from_cohort_id, to_cohort_id, change_kind, effective_from)
      values (v_user, null, v_cohort, 'legacy_backfill', '-infinity'::timestamptz);
    select * into v_state from student_class_state where user_id = v_user;
  end if;
  if v_state.current_cohort_id = p_cohort_id then
    return class_state_json(v_user);
  end if;
  if v_state.self_change_count >= 1 then raise exception 'NO_CHANGE_REMAINING'; end if;
  -- 关闭当前开放区间并切换成员关系（旧班教师保留归属期间的读取，不再看到之后的记录）
  if v_state.current_cohort_id is not null then
    update class_membership_history set effective_to = now()
      where user_id = v_user and to_cohort_id = v_state.current_cohort_id and effective_to is null;
    delete from cohort_members where user_id = v_user and cohort_id = v_state.current_cohort_id and role = 'student';
  else
    update class_membership_history set effective_to = now()
      where user_id = v_user and to_cohort_id is null and effective_to is null;
  end if;
  insert into cohort_members (cohort_id, user_id, role) values (p_cohort_id, v_user, 'student');
  update student_class_state
    set current_cohort_id = p_cohort_id, self_change_count = self_change_count + 1, updated_at = now()
    where user_id = v_user;
  insert into class_membership_history (user_id, from_cohort_id, to_cohort_id, change_kind, request_id, effective_from)
    values (v_user, v_state.current_cohort_id, p_cohort_id, 'change_once', v_request, now());
  return class_state_json(v_user);
end;
$$;

-- 班级归档：任课教师（或项目管理员）确认后停用班级；不影响学生状态与历史记录，
-- 学生仍可经一次换班离开；归档班级不再出现在可选列表。
create or replace function class_archive(p_class_id uuid, p_confirmed boolean default false)
returns boolean language plpgsql volatile security definer as $$
begin
  if not app_manages_class(p_class_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_confirmed is distinct from true then raise exception 'INVALID_INPUT'; end if;
  -- 写入字面量 '0' 兼容 boolean 与 integer 两种建库来源（与 class_create 写 '1' 对应）
  update cohorts set is_active = '0' where id = p_class_id;
  return true;
end;
$$;

-- ============================================================
-- 5) 既有函数收口（create or replace，ACL 不变；不改历史迁移文件）
-- ============================================================
-- 名单绑定器：已有 onboarding 状态的学生不再自动插入成员关系
--（学生已自选/已跳过/已换班后，晚导入或重复同步的名单不自动改其当前班级）。
create or replace function class_bind_trusted_roster(p_class_id uuid default null,p_user_id uuid default null)
returns void language plpgsql security definer as $$
begin
  update class_roster r set user_id=i.user_id
  from class_account_identities i,cohorts c
  where c.id=r.cohort_id and c.is_active::text in ('true','1') and c.owner_id is not null and r.user_id is null
    and (p_class_id is null or r.cohort_id=p_class_id) and (p_user_id is null or i.user_id=p_user_id)
    and ((r.cxid is not null and r.cxid=i.trusted_cxid)
      or (r.student_no is not null and r.student_no=i.trusted_student_no and nullif(c.institution_fid,'')=i.institution_fid))
    and (r.cxid is null or i.trusted_cxid is null or r.cxid=i.trusted_cxid)
    and (r.student_no is null or i.trusted_student_no is null or r.student_no=i.trusted_student_no);
  insert into cohort_members(cohort_id,user_id,role)
    select r.cohort_id,r.user_id,'student' from class_roster r
    where r.user_id is not null and (p_class_id is null or r.cohort_id=p_class_id)
      and (p_user_id is null or r.user_id=p_user_id)
      and not exists (select 1 from student_class_state s where s.user_id=r.user_id)
    on conflict(cohort_id,user_id) do nothing;
end;
$$;

-- 登录身份同步：绑定名单后追加状态固化（唯一匹配自动入班）
create or replace function class_sync_identity() returns boolean language plpgsql security definer as $$
declare v_uid uuid:=auth.uid(); v_app jsonb:=auth.jwt()->'app_metadata'->'chaoxing'; v_meta jsonb:=auth.jwt()->'user_metadata';
begin
  if v_uid is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from profiles where id=v_uid) then
    perform sync_profile_identity(coalesce(nullif(v_app->>'displayName',''),nullif(v_meta->>'realname',''),nullif(v_meta->>'full_name',''),'用户'),
      coalesce(v_app->>'studentNo',''),coalesce(v_app->>'uid',v_meta->>'cxid',''),'student');
  end if;
  insert into class_account_identities(user_id,name,email,claimed_cxid,trusted_cxid,trusted_student_no,institution_fid)
  values(v_uid,coalesce(nullif(v_app->>'displayName',''),nullif(v_meta->>'realname',''),nullif(v_meta->>'full_name',''),'用户'),
    coalesce(auth.jwt()->>'email',''),nullif(v_meta->>'cxid',''),nullif(v_app->>'uid',''),nullif(v_app->>'studentNo',''),nullif(v_app->>'fid',''))
  on conflict(user_id) do update set name=excluded.name,email=excluded.email,claimed_cxid=excluded.claimed_cxid,
    trusted_cxid=excluded.trusted_cxid,trusted_student_no=excluded.trusted_student_no,institution_fid=excluded.institution_fid,updated_at=now();
  perform class_bind_trusted_roster(null,v_uid);
  perform class_ensure_state();
  return true;
end;
$$;

-- 工作区数据：新增学生 state 与教师侧 conflictCount；既有字段保留兼容（requests 为历史只读）
create or replace function class_workspace(p_class_id uuid default null) returns jsonb language plpgsql stable security definer as $$
declare v_teacher boolean:=app_is_teacher(); v_manage boolean:=false; v_classes jsonb; v_requests jsonb;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_class_id is not null then
    if v_teacher then
      if not app_manages_class(p_class_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
      v_manage:=true;
    elsif not exists(select 1 from cohorts where id=p_class_id and is_active::text in ('true','1') and owner_id is not null) then raise exception 'NOT_FOUND'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'ownerId',c.owner_id,'ownerName',coalesce(p.display_name,'任课老师'),
    'memberCount',case when v_teacher then (select count(*) from cohort_members m where m.cohort_id=c.id and m.role='student') else 0 end,
    'rosterCount',case when v_teacher then (select count(*) from class_roster r where r.cohort_id=c.id) else 0 end,
    'pendingCount',case when v_teacher then (select count(*) from class_join_requests r where r.cohort_id=c.id and r.status='pending') else 0 end,
    'conflictCount',case when v_teacher then (select count(*) from cohort_members m where m.cohort_id=c.id and m.role='student'
      and not exists (select 1 from student_class_state s where s.user_id=m.user_id)) else 0 end) order by c.created_at desc),'[]'::jsonb)
  into v_classes from cohorts c left join profiles p on p.id=c.owner_id
  where c.is_active::text in ('true','1') and c.owner_id is not null and (not v_teacher or c.owner_id=auth.uid() or app_is_project_admin());
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'classId',r.cohort_id,'userId',r.user_id,'name',coalesce(i.name,p.display_name,'学生'),
    'cxid',coalesce(i.trusted_cxid,i.claimed_cxid),'studentNo',r.student_no,'status',r.status) order by r.updated_at desc),'[]'::jsonb)
  into v_requests from class_join_requests r left join profiles p on p.id=r.user_id left join class_account_identities i on i.user_id=r.user_id
  where (v_manage and r.cohort_id=p_class_id) or (not v_teacher and r.user_id=auth.uid());
  return jsonb_build_object('isAdmin',app_is_project_admin(),'classes',v_classes,'requests',v_requests,
    'state',class_state_json(auth.uid()),
    'memberships',coalesce((select jsonb_agg(m.cohort_id) from cohort_members m where m.user_id=auth.uid()),'[]'::jsonb),
    'members',case when v_manage then coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'name',p.display_name,'studentNo',p.student_no,'cxid',p.chaoxing_uid)) from cohort_members m join profiles p on p.id=m.user_id where m.cohort_id=p_class_id and m.role='student'),'[]'::jsonb) else '[]'::jsonb end,
    'roster',case when v_manage then coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'studentNo',r.student_no,'cxid',r.cxid,'userId',r.user_id) order by r.name) from class_roster r where r.cohort_id=p_class_id),'[]'::jsonb) else '[]'::jsonb end);
end;
$$;

-- ============================================================
-- 6) 权限收口
-- ============================================================
-- 旧申请—审批流程停用（表与历史数据保留只读；API 层同步返回废弃响应）
revoke execute on function class_request_join(uuid,text), class_review_request(uuid,boolean) from authenticated;

-- 内部函数：不向客户端授予 EXECUTE
revoke all on function class_state_json(uuid), app_member_at(uuid,uuid,timestamptz), class_ensure_state() from public, anon, authenticated;

-- 客户端可执行的新受控入口
revoke all on function class_initial_select(uuid,text), class_skip_guest(text), class_change_once(uuid,text), class_archive(uuid,boolean), app_can_view_training(uuid,uuid,timestamptz) from public, anon;
grant execute on function class_initial_select(uuid,text), class_skip_guest(text), class_change_once(uuid,text), class_archive(uuid,boolean), app_can_view_training(uuid,uuid,timestamptz) to authenticated;

commit;
