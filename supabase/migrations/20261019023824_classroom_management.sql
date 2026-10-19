begin;

-- 复用 cohorts/cohort_members。历史默认班级与训练的绑定不改写。
-- 平台 cohorts.is_active 是 integer，历史建库文件为 boolean；统一比较其文本真值，
-- 不修改线上字段类型，写入未定类型字面量以兼容两种建库来源。
alter table cohorts add column owner_id uuid references profiles(id);
create index cohorts_owner_idx on cohorts(owner_id);

create table project_administrators (
  user_id uuid primary key references profiles(id),
  created_at timestamptz not null default now()
);
create table teacher_access_grants (
  user_id uuid primary key references profiles(id),
  cxid text not null,
  granted_by uuid not null references profiles(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table class_account_identities (
  user_id uuid primary key references profiles(id),
  name text not null,
  email text not null default '',
  claimed_cxid text,
  trusted_cxid text,
  trusted_student_no text,
  institution_fid text,
  updated_at timestamptz not null default now()
);
create unique index class_identity_trusted_uid on class_account_identities(trusted_cxid) where trusted_cxid is not null;
create unique index class_identity_trusted_student on class_account_identities(institution_fid,trusted_student_no) where nullif(institution_fid,'') is not null and trusted_student_no is not null;
create table class_roster (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id),
  name text not null check (length(name) between 1 and 80),
  cxid text check (cxid ~ '^[0-9]{1,32}$'),
  student_no text check (length(student_no) between 1 and 64),
  user_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (cxid is not null or student_no is not null)
);
create unique index class_roster_cxid on class_roster(cohort_id,cxid) where cxid is not null;
create unique index class_roster_student_no on class_roster(cohort_id,student_no) where student_no is not null;
create index class_roster_user on class_roster(user_id);
create table class_join_requests (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id),
  user_id uuid not null references profiles(id),
  student_no text check(length(student_no) <= 64),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  reviewed_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique(cohort_id,user_id)
);
create index class_requests_pending on class_join_requests(cohort_id,status);
create table teacher_access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  target_id uuid not null,
  action text not null check(action in ('grant','revoke')),
  created_at timestamptz not null default now()
);

-- 不访问 auth.users；保留现有邮箱白名单，新授权固定绑定 auth.uid()。
create or replace function app_is_teacher() returns boolean language sql stable security definer as $$
  select auth.uid() is not null and (
    exists(select 1 from teacher_emails te where lower(te.email)=lower(auth.jwt()->>'email'))
    or exists(select 1 from teacher_access_grants g where g.user_id=auth.uid() and g.revoked_at is null)
  );
$$;
create or replace function app_is_project_admin() returns boolean language sql stable security definer as $$
  select app_is_teacher() and exists(select 1 from project_administrators a where a.user_id=auth.uid());
$$;
create or replace function app_manages_class(p_class_id uuid) returns boolean language sql stable security definer as $$
  select app_is_teacher() and exists(select 1 from cohorts c where c.id=p_class_id and c.is_active::text in ('true','1') and (c.owner_id=auth.uid() or app_is_project_admin()));
$$;
create or replace function app_can_view_student(p_user_id uuid) returns boolean language sql stable security definer as $$
  select app_is_teacher() and (app_is_project_admin() or exists(
    select 1 from cohort_members m join cohorts c on c.id=m.cohort_id
    where m.user_id=p_user_id and m.role='student' and c.is_active::text in ('true','1') and c.owner_id=auth.uid()
  ));
$$;

alter table project_administrators enable row level security;
alter table teacher_access_grants enable row level security;
alter table class_account_identities enable row level security;
alter table class_roster enable row level security;
alter table class_join_requests enable row level security;
alter table teacher_access_audit enable row level security;
revoke all on project_administrators,teacher_access_grants,class_account_identities,class_roster,class_join_requests,teacher_access_audit from public,anon,authenticated;
grant select on class_account_identities,class_roster,class_join_requests to authenticated;
create policy identity_read on class_account_identities for select to authenticated using(user_id=auth.uid() or app_is_project_admin());
create policy roster_read on class_roster for select to authenticated using(app_manages_class(cohort_id));
create policy requests_read on class_join_requests for select to authenticated using(user_id=auth.uid() or app_manages_class(cohort_id));

-- 内部绑定器：不向客户端授予 EXECUTE。仅使用不可由用户修改的服务端编号。
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
    on conflict(cohort_id,user_id) do nothing;
end;
$$;
revoke all on function class_bind_trusted_roster(uuid,uuid) from public,anon,authenticated;

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
  return true;
end;
$$;

create or replace function class_create(p_name text) returns uuid language plpgsql security definer as $$
declare v_id uuid:=gen_random_uuid();
begin
  if not app_is_teacher() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'INVALID_INPUT'; end if;
  -- 同一教师同名班级幂等，跨教师同名不合并。
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext(trim(p_name)));
  select id into v_id from cohorts where owner_id=auth.uid() and name=trim(p_name) and is_active::text in ('true','1') limit 1;
  if v_id is not null then return v_id; end if;
  v_id:=gen_random_uuid();
  insert into cohorts(id,name,institution_fid,is_active,owner_id)
    values(v_id,trim(p_name),coalesce(auth.jwt()->'app_metadata'->'chaoxing'->>'fid',''),'1',auth.uid());
  return v_id;
end;
$$;

create or replace function class_import_roster(p_class_id uuid,p_rows jsonb) returns integer language plpgsql security definer as $$
declare v_row jsonb; v_name text; v_cxid text; v_no text; v_existing class_roster%rowtype; v_count integer:=0; v_matches integer;
begin
  if not app_manages_class(p_class_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
  perform 1 from cohorts where id=p_class_id for update;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_name:=trim(v_row->>'name'); v_cxid:=nullif(trim(v_row->>'cxid'),''); v_no:=nullif(trim(v_row->>'studentNo'),'');
    if v_name is null or length(v_name) not between 1 and 80 or (v_cxid is null and v_no is null)
      or (v_cxid is not null and v_cxid !~ '^[0-9]{1,32}$') or length(v_no)>64 then raise exception 'INVALID_INPUT'; end if;
    select count(*) into v_matches from class_roster where cohort_id=p_class_id and ((v_cxid is not null and cxid=v_cxid) or (v_no is not null and student_no=v_no));
    if v_matches>1 then raise exception 'IDENTITY_CONFLICT'; end if;
    if v_matches=1 then
      select * into v_existing from class_roster where cohort_id=p_class_id and ((v_cxid is not null and cxid=v_cxid) or (v_no is not null and student_no=v_no));
      if v_existing.name is distinct from v_name or v_existing.cxid is distinct from v_cxid or v_existing.student_no is distinct from v_no then raise exception 'IDENTITY_CONFLICT'; end if;
    else insert into class_roster(cohort_id,name,cxid,student_no) values(p_class_id,v_name,v_cxid,v_no); v_count:=v_count+1;
    end if;
  end loop;
  perform class_bind_trusted_roster(p_class_id,null);
  return v_count;
end;
$$;

create or replace function class_request_join(p_class_id uuid,p_student_no text default '') returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from cohorts where id=p_class_id and is_active::text in ('true','1') and owner_id is not null) then raise exception 'NOT_FOUND'; end if;
  if length(p_student_no)>64 then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from cohort_members where cohort_id=p_class_id and user_id=auth.uid()) then return null; end if;
  insert into class_join_requests(cohort_id,user_id,student_no) values(p_class_id,auth.uid(),nullif(trim(p_student_no),''))
  on conflict(cohort_id,user_id) do update set status='pending',student_no=excluded.student_no,reviewed_by=null,updated_at=now()
  where class_join_requests.status<>'approved' returning id into v_id;
  return v_id;
end;
$$;

create or replace function class_review_request(p_request_id uuid,p_approve boolean) returns boolean language plpgsql security definer as $$
declare v_request class_join_requests%rowtype; v_i class_account_identities%rowtype; v_matches integer; v_roster class_roster%rowtype;
begin
  select * into v_request from class_join_requests where id=p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not app_manages_class(v_request.cohort_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if v_request.status<>'pending' then return v_request.status='approved'; end if;
  if p_approve is null then raise exception 'INVALID_INPUT'; end if;
  if p_approve then
    select * into v_i from class_account_identities where user_id=v_request.user_id;
    select count(*) into v_matches from class_roster r where r.cohort_id=v_request.cohort_id and
      ((coalesce(v_i.trusted_cxid,v_i.claimed_cxid) is not null and r.cxid=coalesce(v_i.trusted_cxid,v_i.claimed_cxid)) or (v_request.student_no is not null and r.student_no=v_request.student_no));
    if v_matches>1 then raise exception 'IDENTITY_CONFLICT'; end if;
    if v_matches=1 then
      select * into v_roster from class_roster r where r.cohort_id=v_request.cohort_id and
        ((coalesce(v_i.trusted_cxid,v_i.claimed_cxid) is not null and r.cxid=coalesce(v_i.trusted_cxid,v_i.claimed_cxid)) or (v_request.student_no is not null and r.student_no=v_request.student_no)) for update;
      if v_roster.user_id is not null and v_roster.user_id<>v_request.user_id then raise exception 'IDENTITY_CONFLICT'; end if;
      update class_roster set user_id=v_request.user_id where id=v_roster.id;
    end if;
    insert into cohort_members(cohort_id,user_id,role) values(v_request.cohort_id,v_request.user_id,'student') on conflict(cohort_id,user_id) do nothing;
  end if;
  update class_join_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),updated_at=now() where id=p_request_id;
  return p_approve;
end;
$$;

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
    'pendingCount',case when v_teacher then (select count(*) from class_join_requests r where r.cohort_id=c.id and r.status='pending') else 0 end) order by c.created_at desc),'[]'::jsonb)
  into v_classes from cohorts c left join profiles p on p.id=c.owner_id
  where c.is_active::text in ('true','1') and c.owner_id is not null and (not v_teacher or c.owner_id=auth.uid() or app_is_project_admin());
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'classId',r.cohort_id,'userId',r.user_id,'name',coalesce(i.name,p.display_name,'学生'),
    'cxid',coalesce(i.trusted_cxid,i.claimed_cxid),'studentNo',r.student_no,'status',r.status) order by r.updated_at desc),'[]'::jsonb)
  into v_requests from class_join_requests r left join profiles p on p.id=r.user_id left join class_account_identities i on i.user_id=r.user_id
  where (v_manage and r.cohort_id=p_class_id) or (not v_teacher and r.user_id=auth.uid());
  return jsonb_build_object('isAdmin',app_is_project_admin(),'classes',v_classes,'requests',v_requests,
    'memberships',coalesce((select jsonb_agg(m.cohort_id) from cohort_members m where m.user_id=auth.uid()),'[]'::jsonb),
    'members',case when v_manage then coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'name',p.display_name,'studentNo',p.student_no,'cxid',p.chaoxing_uid)) from cohort_members m join profiles p on p.id=m.user_id where m.cohort_id=p_class_id and m.role='student'),'[]'::jsonb) else '[]'::jsonb end,
    'roster',case when v_manage then coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'studentNo',r.student_no,'cxid',r.cxid,'userId',r.user_id) order by r.name) from class_roster r where r.cohort_id=p_class_id),'[]'::jsonb) else '[]'::jsonb end);
end;
$$;

create or replace function teacher_access_workspace(p_cxid text default '') returns jsonb language plpgsql stable security definer as $$
begin
  if not app_is_project_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_cxid<>'' and p_cxid !~ '^[0-9]{1,32}$' then raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object(
    'teachers',coalesce((select jsonb_agg(jsonb_build_object('userId',i.user_id,'name',i.name,'cxid',coalesce(i.trusted_cxid,i.claimed_cxid),'email',i.email,'isTeacher',true,'isAdmin',exists(select 1 from project_administrators a where a.user_id=i.user_id)))
      from class_account_identities i where exists(select 1 from teacher_access_grants g where g.user_id=i.user_id and g.revoked_at is null) or exists(select 1 from project_administrators a where a.user_id=i.user_id)),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(jsonb_build_object('userId',i.user_id,'name',i.name,'cxid',coalesce(i.trusted_cxid,i.claimed_cxid),'email',i.email,
      'isTeacher',exists(select 1 from teacher_access_grants g where g.user_id=i.user_id and g.revoked_at is null) or exists(select 1 from teacher_emails te where lower(te.email)=lower(i.email)),
      'isAdmin',exists(select 1 from project_administrators a where a.user_id=i.user_id)))
      from class_account_identities i where p_cxid<>'' and coalesce(i.trusted_cxid,i.claimed_cxid)=p_cxid),'[]'::jsonb));
end;
$$;

create or replace function teacher_access_grant(p_user_id uuid,p_cxid text,p_confirmed boolean) returns boolean language plpgsql security definer as $$
declare v_i class_account_identities%rowtype;
begin
  if not app_is_project_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_confirmed is distinct from true then raise exception 'INVALID_INPUT'; end if;
  select * into v_i from class_account_identities where user_id=p_user_id for update;
  if not found or coalesce(v_i.trusted_cxid,v_i.claimed_cxid) is distinct from p_cxid then raise exception 'IDENTITY_CONFLICT'; end if;
  insert into teacher_access_grants(user_id,cxid,granted_by) values(p_user_id,p_cxid,auth.uid())
  on conflict(user_id) do update set cxid=excluded.cxid,granted_by=auth.uid(),granted_at=now(),revoked_at=null;
  update profiles set app_role='teacher' where id=p_user_id;
  insert into teacher_access_audit(actor_id,target_id,action) values(auth.uid(),p_user_id,'grant');
  return true;
end;
$$;
create or replace function teacher_access_revoke(p_user_id uuid,p_confirmed boolean) returns boolean language plpgsql security definer as $$
begin
  if not app_is_project_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_confirmed is distinct from true then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from project_administrators where user_id=p_user_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  -- 本界面只撤销由本界面新增的授权，不暗中删除旧平台白名单。
  if exists(select 1 from class_account_identities i join teacher_emails te on lower(te.email)=lower(i.email) where i.user_id=p_user_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  update teacher_access_grants set revoked_at=now() where user_id=p_user_id and revoked_at is null;
  update profiles set app_role='student' where id=p_user_id;
  insert into teacher_access_audit(actor_id,target_id,action) values(auth.uid(),p_user_id,'revoke');
  return true;
end;
$$;

revoke all on function app_is_teacher(),app_is_project_admin(),app_manages_class(uuid),app_can_view_student(uuid),class_sync_identity(),class_create(text),class_import_roster(uuid,jsonb),class_request_join(uuid,text),class_review_request(uuid,boolean),class_workspace(uuid),teacher_access_workspace(text),teacher_access_grant(uuid,text,boolean),teacher_access_revoke(uuid,boolean) from public,anon;
grant execute on function app_is_teacher(),app_is_project_admin(),app_manages_class(uuid),app_can_view_student(uuid),class_sync_identity(),class_create(text),class_import_roster(uuid,jsonb),class_request_join(uuid,text),class_review_request(uuid,boolean),class_workspace(uuid),teacher_access_workspace(text),teacher_access_grant(uuid,text,boolean),teacher_access_revoke(uuid,boolean) to authenticated;

-- 教师数据范围的策略与统计函数在同一事务后续部分统一收紧。

create policy class_scope_profiles on profiles as restrictive for all to authenticated using (id=auth.uid() or app_can_view_student(id)) with check (id=auth.uid() or app_can_view_student(id));

create policy class_scope_training_sessions on training_sessions as restrictive for all to authenticated using (user_id=auth.uid() or app_can_view_student(user_id)) with check (user_id=auth.uid() or app_can_view_student(user_id));

create policy class_scope_training_reports on training_reports as restrictive for all to authenticated using (user_id=auth.uid() or app_can_view_student(user_id)) with check (user_id=auth.uid() or app_can_view_student(user_id));

create policy class_scope_ability_profiles on ability_profiles as restrictive for all to authenticated using (user_id=auth.uid() or app_can_view_student(user_id)) with check (user_id=auth.uid() or app_can_view_student(user_id));

create policy class_scope_quiz_assignments on quiz_assignments as restrictive for all to authenticated using (user_id=auth.uid() or app_can_view_student(user_id)) with check (user_id=auth.uid() or app_can_view_student(user_id));

create policy class_scope_student_engagement_events on student_engagement_events as restrictive for all to authenticated using (user_id=auth.uid() or app_can_view_student(user_id)) with check (user_id=auth.uid() or app_can_view_student(user_id));

create policy class_scope_student_active_intervals on student_active_intervals as restrictive for all to authenticated using (user_id=auth.uid() or app_can_view_student(user_id)) with check (user_id=auth.uid() or app_can_view_student(user_id));

create policy class_scope_training_messages on training_messages as restrictive for all to authenticated using (exists(select 1 from training_sessions s where s.id=session_id and (s.user_id=auth.uid() or app_can_view_student(s.user_id)))) with check (exists(select 1 from training_sessions s where s.id=session_id and (s.user_id=auth.uid() or app_can_view_student(s.user_id))));

create policy class_scope_clinical_operations on clinical_operations as restrictive for all to authenticated using (exists(select 1 from training_sessions s where s.id=session_id and (s.user_id=auth.uid() or app_can_view_student(s.user_id)))) with check (exists(select 1 from training_sessions s where s.id=session_id and (s.user_id=auth.uid() or app_can_view_student(s.user_id))));

create policy class_scope_agent_call_records on agent_call_records as restrictive for all to authenticated using (exists(select 1 from training_sessions s where s.id=session_id and (s.user_id=auth.uid() or app_can_view_student(s.user_id)))) with check (exists(select 1 from training_sessions s where s.id=session_id and (s.user_id=auth.uid() or app_can_view_student(s.user_id))));

create policy class_teacher_read_profiles on profiles for select to authenticated using(app_can_view_student(id));
create policy class_teacher_read_training_sessions on training_sessions for select to authenticated using(app_can_view_student(user_id));
create policy class_teacher_read_training_reports on training_reports for select to authenticated using(app_can_view_student(user_id));
create policy class_teacher_read_ability_profiles on ability_profiles for select to authenticated using(app_can_view_student(user_id));
create policy class_teacher_read_quiz_assignments on quiz_assignments for select to authenticated using(app_can_view_student(user_id));

create policy class_teacher_read_training_messages on training_messages for select to authenticated using(exists(select 1 from training_sessions s where s.id=session_id and app_can_view_student(s.user_id)));
create policy class_teacher_read_clinical_operations on clinical_operations for select to authenticated using(exists(select 1 from training_sessions s where s.id=session_id and app_can_view_student(s.user_id)));
create policy class_teacher_read_agent_call_records on agent_call_records for select to authenticated using(exists(select 1 from training_sessions s where s.id=session_id and app_can_view_student(s.user_id)));

create policy class_scope_members on cohort_members as restrictive for select to authenticated using(user_id=auth.uid() or app_manages_class(cohort_id));

-- 成员与班级只能由受控 RPC 修改，学生不能直接把自己插入班级。
revoke insert,update,delete on cohorts,cohort_members from public,authenticated,anon;

-- SECURITY DEFINER 聚合不经过调用者 RLS，必须逐一限制资料来源。
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
  if p_user_id is not null and not app_can_view_student(p_user_id) then
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
      and p.account_kind <> 'test' and app_can_view_student(p.id)
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
  if p_user_id is not null and not app_can_view_student(p_user_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;
  v_from_ts := p_from_date::timestamp - interval '8 hours';
  v_to_ts := (p_to_date + 1)::timestamp - interval '8 hours';

  return jsonb_build_object(
    'studentCount', (select count(distinct ts.user_id) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
      where (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'sessionCount', (select count(*) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
      where (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'completedCount', (select count(*) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
      where ts.status = 'completed'
        and (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'inProgressCount', (select count(*) from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
      where ts.status = 'active' and ts.updated_at >= now() - interval '2 hours'
        and (v_from_ts is null or ts.started_at >= v_from_ts)
        and (v_to_ts is null or ts.started_at < v_to_ts)
        and (p_user_id is null or ts.user_id = p_user_id)
        and (p_case_id is null or ts.case_id = p_case_id))::int,
    'totalTurnCount', coalesce((
      select sum(m.turn_count)
      from training_sessions ts
      join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
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
      join profiles p2 on p2.id = ai.user_id and p2.app_role = 'student' and p2.account_kind <> 'test' and app_can_view_student(p2.id)
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
  if p_user_id is not null and not app_can_view_student(p_user_id) then
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
    join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
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
  if p_user_id is not null and not app_can_view_student(p_user_id) then
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
    join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
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
  if p_user_id is not null and not app_can_view_student(p_user_id) then
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
    join profiles p on p.id = ts.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
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
  if p_user_id is not null and not app_can_view_student(p_user_id) then
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
    join profiles p on p.id = qa.user_id and p.app_role = 'student' and p.account_kind <> 'test' and app_can_view_student(p.id)
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
  if p_user_id is not null and not app_can_view_student(p_user_id) then
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
