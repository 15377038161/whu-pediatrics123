begin;


-- D10 独立学习资源中心（方案第 13 节；对齐既有惯例：手写 SQL 迁移经 db_execute 执行，不改历史迁移）。
-- 1) 新表：learning_resources（资源元数据，视频/图文分类）、resource_class_visibility（班级可见范围）、
--    resource_progress（观看进度，本人幂等，断点续播）。
-- 2) 访问契约：fileId（平台对象存储标识）入库，不存 URL；播放前由服务端校验可见范围后经 StorageClient.getFile
--    动态取带期限链接（方案 13.3：不把临时签名 URL 当永久数据库值，不暴露存储凭据，不做开放 URL 代理）。
-- 3) 学生访问全部经 SECURITY DEFINER RPC 投影（与题库 quiz_bank_list_student 同模式）：
--    resource_list_student / resource_get_student / resource_progress_upsert；
--    可见性谓词与 quiz_bank_list_student 同源：已发布 + (platform 或本人所在可见班级)。
--    学生无表直读策略（direct SELECT 仅 owner/teacher/admin 匹配，学生 0 行）——学生数据面不暴露。
-- 4) 教师写保护（对齐 question_bank_write_guard 模式）：教师 INSERT 强制 draft/class；
--    UPDATE 保护 owner_id/scope（platform 范围仅项目管理员）；状态迁移白名单 draft→published→retired→draft；
--    发布需 file_id 非空，class 范围需至少一个本人管辖班级授权行；updated_at 服务端维护。
-- 5) progress 写入仅经 SECURITY DEFINER RPC（范围校验 + 本人幂等）；进度不当掌握程度，不接入学情统计。


-- ============================================================
-- 1) 新表
-- ============================================================
create table learning_resources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  description text,
  kind text not null default 'video' check (kind in ('video', 'document')),
  topic text,
  cover_file_id text,
  file_id text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  source text,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  scope text not null default 'class' check (scope in ('class', 'platform')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create index learning_resources_list_idx on learning_resources (status, scope, sort_order, updated_at desc);
create index learning_resources_owner_idx on learning_resources (owner_id, status);


create table resource_class_visibility (
  resource_id uuid not null references learning_resources(id) on delete cascade,
  cohort_id uuid not null references cohorts(id) on delete cascade,
  granted_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  primary key (resource_id, cohort_id)
);


create index resource_class_visibility_cohort_idx on resource_class_visibility (cohort_id);


create table resource_progress (
  user_id uuid not null references profiles(id) on delete cascade,
  resource_id uuid not null references learning_resources(id) on delete cascade,
  position_seconds integer not null default 0 check (position_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);


-- ============================================================
-- 2) RLS：enable + 最小授权 + 策略
-- ============================================================
alter table learning_resources enable row level security;
alter table resource_class_visibility enable row level security;
alter table resource_progress enable row level security;


revoke all on learning_resources, resource_class_visibility, resource_progress from public, anon;
-- 资源/可见范围：教师维护者经 RLS 写（触发器守卫收口）；进度：只读授权，写入仅经受控 RPC
grant select, insert, update, delete on learning_resources to authenticated;
grant select, insert, delete on resource_class_visibility to authenticated;
grant select on resource_progress to authenticated;


-- 维护者读（含历史行只读面，与题库 write_guard 批次口径一致）
create policy learning_resources_owner_select on learning_resources
  for select to authenticated using (owner_id = auth.uid());
-- 教师可读已发布资源元数据（教学协作预览；草稿仅维护者与项目管理员可见）
create policy learning_resources_teacher_read on learning_resources
  for select to authenticated using (app_is_teacher() and status = 'published');
-- 维护者写（教师白名单门控；写入形态由 learning_resources_write_guard 触发器收口）
create policy learning_resources_owner_manage on learning_resources
  for all to authenticated
  using (owner_id = auth.uid() and app_is_teacher())
  with check (owner_id = auth.uid() and app_is_teacher());
create policy learning_resources_admin on learning_resources
  for all to authenticated
  using (app_is_teacher() and app_is_project_admin())
  with check (app_is_teacher() and app_is_project_admin());


-- 可见范围：维护者读写（授权目标限本人管辖班级）
create policy resource_visibility_owner_select on resource_class_visibility
  for select to authenticated
  using (exists (select 1 from learning_resources r where r.id = resource_id and r.owner_id = auth.uid()));
create policy resource_visibility_owner_manage on resource_class_visibility
  for all to authenticated
  using (exists (select 1 from learning_resources r where r.id = resource_id and r.owner_id = auth.uid()))
  with check (
    exists (select 1 from learning_resources r where r.id = resource_id and r.owner_id = auth.uid())
    and app_is_teacher()
    and app_manages_class(cohort_id)
  );
create policy resource_visibility_admin on resource_class_visibility
  for all to authenticated
  using (app_is_teacher() and app_is_project_admin())
  with check (app_is_teacher() and app_is_project_admin());


-- 进度：仅本人可读；写入仅经 resource_progress_upsert（受控 RPC）
create policy resource_progress_self_select on resource_progress
  for select to authenticated using (user_id = auth.uid());


-- ============================================================
-- 3) 教师写守卫触发器（对齐 question_banks_publish_guard 模式）
-- ============================================================
create or replace function learning_resources_write_guard() returns trigger
language plpgsql as $$
begin
  -- updated_at 服务端维护
  NEW.updated_at := now();

  if tg_op = 'INSERT' then
    -- 项目管理员直建不受教师默认值约束
    if not (select app_is_project_admin()) then
      NEW.status := 'draft';
      NEW.scope := 'class';
    end if;
    return NEW;
  end if;

  -- UPDATE：项目管理员放行（platform 发布/维护路径）
  if (select app_is_project_admin()) then
    return NEW;
  end if;

  -- 教师（维护者）：owner_id/scope 保护
  if NEW.owner_id <> OLD.owner_id then
    raise exception 'OWNER_PROTECTED' using errcode = '42501';
  end if;
  if NEW.scope <> OLD.scope then
    raise exception 'SCOPE_PROTECTED' using errcode = '42501';
  end if;
  -- 状态迁移白名单：draft→published（发布）、published→retired（下架）、retired→draft（重新编辑）
  if NEW.status <> OLD.status then
    if not (
      (OLD.status = 'draft' and NEW.status = 'published')
      or (OLD.status = 'published' and NEW.status = 'retired')
      or (OLD.status = 'retired' and NEW.status = 'draft')
    ) then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
    end if;
  end if;
  -- 发布校验：file_id 非空；class 范围需至少一个本人管辖班级授权行
  if NEW.status = 'published' and OLD.status <> 'published' then
    if btrim(coalesce(NEW.file_id, '')) = '' then
      raise exception 'FILE_REQUIRED' using errcode = 'P0001';
    end if;
    if NEW.scope = 'class' and not exists (
      select 1 from resource_class_visibility v
      join cohorts c on c.id = v.cohort_id and c.is_active::text in ('true', '1')
      where v.resource_id = NEW.id and c.owner_id = NEW.owner_id
    ) then
      raise exception 'VISIBILITY_REQUIRED' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;


create trigger learning_resources_write_guard_trigger
  before insert or update on learning_resources
  for each row execute function learning_resources_write_guard();


-- ============================================================
-- 4) 受控 RPC
-- ============================================================
-- 4.1 学生可见资源列表（已发布 + platform 或本人所在可见班级；含本人断点进度与最近学习时间）
create or replace function resource_list_student() returns jsonb
language sql stable security definer as $$
  select coalesce(jsonb_agg(t order by t."sortOrder", t."updatedAt" desc), '[]'::jsonb)
  from (
    select
      r.id as "resourceId",
      r.title,
      coalesce(r.description, '') as "description",
      r.kind,
      coalesce(r.topic, '') as "topic",
      r.cover_file_id as "coverFileId",
      r.duration_seconds as "durationSeconds",
      coalesce(r.source, '') as "source",
      (r.scope = 'platform') as "platformWide",
      r.sort_order as "sortOrder",
      p.position_seconds as "positionSeconds",
      p.updated_at as "progressUpdatedAt",
      r.updated_at as "updatedAt"
    from learning_resources r
    left join resource_progress p on p.resource_id = r.id and p.user_id = auth.uid()
    where r.status = 'published'
      and (
        r.scope = 'platform'
        or exists (
          select 1 from resource_class_visibility v
          join cohort_members m on m.cohort_id = v.cohort_id and m.user_id = auth.uid() and m.role = 'student'
          join cohorts c on c.id = v.cohort_id and c.is_active::text in ('true', '1')
          where v.resource_id = r.id
        )
      )
  ) t;
$$;


revoke all on function resource_list_student() from public, anon;
grant execute on function resource_list_student() to authenticated;


-- 4.2 学生资源详情（同一可见性谓词；不可见一律 NOT_FOUND，不泄露存在性）
create or replace function resource_get_student(p_resource_id uuid) returns jsonb
language plpgsql stable security definer as $$
declare
  v_user uuid := auth.uid();
  v_resource record;
  v_visible boolean;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_resource from learning_resources where id = p_resource_id;
  if not found or v_resource.status <> 'published' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_visible := v_resource.scope = 'platform' or exists (
    select 1 from resource_class_visibility v
    join cohort_members m on m.cohort_id = v.cohort_id and m.user_id = v_user and m.role = 'student'
    join cohorts c on c.id = v.cohort_id and c.is_active::text in ('true', '1')
    where v.resource_id = p_resource_id
  );
  if not v_visible then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'resourceId', v_resource.id,
    'title', v_resource.title,
    'description', coalesce(v_resource.description, ''),
    'kind', v_resource.kind,
    'topic', coalesce(v_resource.topic, ''),
    'coverFileId', v_resource.cover_file_id,
    'fileId', v_resource.file_id,
    'durationSeconds', v_resource.duration_seconds,
    'source', coalesce(v_resource.source, ''),
    'platformWide', v_resource.scope = 'platform',
    'updatedAt', v_resource.updated_at,
    'positionSeconds', (
      select p.position_seconds from resource_progress p
      where p.resource_id = p_resource_id and p.user_id = v_user
    ),
    'progressUpdatedAt', (
      select p.updated_at from resource_progress p
      where p.resource_id = p_resource_id and p.user_id = v_user
    )
  );
end;
$$;


revoke all on function resource_get_student(uuid) from public, anon;
grant execute on function resource_get_student(uuid) to authenticated;


-- 4.3 进度幂等更新：仅本人、范围校验后 upsert（断点续播；进度不当掌握程度，不入临床评分）
create or replace function resource_progress_upsert(p_resource_id uuid, p_position_seconds integer) returns jsonb
language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_resource record;
  v_visible boolean;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_resource_id is null or p_position_seconds is null or p_position_seconds < 0 then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  select * into v_resource from learning_resources where id = p_resource_id;
  if not found or v_resource.status <> 'published' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_visible := v_resource.scope = 'platform' or exists (
    select 1 from resource_class_visibility v
    join cohort_members m on m.cohort_id = v.cohort_id and m.user_id = v_user and m.role = 'student'
    join cohorts c on c.id = v.cohort_id and c.is_active::text in ('true', '1')
    where v.resource_id = p_resource_id
  );
  if not v_visible then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  insert into resource_progress (user_id, resource_id, position_seconds)
  values (v_user, p_resource_id, p_position_seconds)
  on conflict (user_id, resource_id)
  do update set position_seconds = excluded.position_seconds, updated_at = now();

  return jsonb_build_object(
    'resourceId', p_resource_id,
    'positionSeconds', p_position_seconds,
    'updatedAt', (select p.updated_at from resource_progress p where p.user_id = v_user and p.resource_id = p_resource_id)
  );
end;
$$;


revoke all on function resource_progress_upsert(uuid, integer) from public, anon;
grant execute on function resource_progress_upsert(uuid, integer) to authenticated;


commit;
