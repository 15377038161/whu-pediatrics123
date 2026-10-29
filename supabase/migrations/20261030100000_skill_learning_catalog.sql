begin;


-- 批次7·独立技能学习模块（功能包批次7：技能学习目录+观看进度；对齐既有惯例：手写 SQL 迁移经 db_execute 执行，不改历史迁移）。
-- 1) 新表 skills（8 项儿科技能学习目录，种子数据落库；目录元数据无临床敏感内容）。
-- 2) learning_resources 增加 skill_id 关联列：一项技能可挂多个视频/图文资源，复用批次5资源上传/播放/可见性链路。
-- 3) resource_progress 增加 completed_at 完成标记：观看位置达到资源时长 90% 自动标记（幂等仅前进）；
--    进度与完成标记不当掌握程度、不接入学情评分（与批次5口径一致）。
-- 4) 学生访问沿用 SECURITY DEFINER RPC 投影范式：skill_catalog_student（技能目录+完成度聚合）；
--    resource_list_student / resource_get_student / resource_progress_upsert 扩展 skillId 与 completedAt 输出。
-- 5) 技能项写权限不开放（种子由迁移维护）；教师绑定资源到技能走现有 learning_resources_owner_manage RLS。


-- ============================================================
-- 1) skills 目录表 + 种子
-- ============================================================
create table skills (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (btrim(slug) <> ''),
  title text not null check (btrim(title) <> ''),
  description text,
  category text,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create index skills_list_idx on skills (status, sort_order);


-- 8 项儿科常见技能学习目录（种子；描述为通用学习目标，不构成评分标准，不猜院校技能清单口径）。
insert into skills (slug, title, description, category, sort_order) values
  ('pediatric-cpr', '小儿心肺复苏', '儿童及婴儿基础生命支持流程：判断、呼救、按压、通气与除颤要点。', '急救', 1),
  ('neonatal-resuscitation', '新生儿复苏', '新生儿室息复苏流程：快速评估、初步复苏、正压通气与胸外按压。', '急救', 2),
  ('lumbar-puncture', '腰椎穿刺', '腰椎穿刺适应证、体位摆放、无菌操作与术后处理。', '穿刺操作', 3),
  ('bone-marrow-aspiration', '骨髓穿刺', '骨髓穿刺部位选择、无菌操作、涂片标本处理与术后观察。', '穿刺操作', 4),
  ('thoracentesis', '胸腔穿刺', '胸腔穿刺定位、无菌操作、引流观察与并发症识别。', '穿刺操作', 5),
  ('abdominal-paracentesis', '腹腔穿刺', '腹腔穿刺适应证、定位、操作要点与术后护理。', '穿刺操作', 6),
  ('urinary-catheterization', '导尿术', '儿童导尿适应证、无菌操作流程、导管选择与护理记录。', '临床操作', 7),
  ('venipuncture', '静脉采血与穿刺', '儿童静脉采血血管选择、固定技巧、穿刺操作与标本处理。', '临床操作', 8);


-- ============================================================
-- 2) learning_resources.skill_id 关联 + resource_progress.completed_at 完成标记
-- ============================================================
alter table learning_resources
  add column skill_id uuid references skills(id) on delete set null;


create index learning_resources_skill_idx on learning_resources (skill_id, status);


alter table resource_progress
  add column completed_at timestamptz;


-- ============================================================
-- 3) RLS：enable + 最小授权 + 策略
-- ============================================================
alter table skills enable row level security;


revoke all on skills from public, anon;
-- 技能目录为教学元数据：登录用户（学生/教师）全员可读；不授予写权限（种子由迁移维护，退役走后续管理迁移）
grant select on skills to authenticated;


create policy skills_authenticated_select on skills
  for select to authenticated using (true);


-- ============================================================
-- 4) 受控 RPC 扩展与新增
-- ============================================================
-- 4.1 学生技能目录：技能 + 可见资源计数 + 本人完成计数（完成度仅展示，不当掌握程度、不入评分）
create or replace function skill_catalog_student() returns jsonb
language sql stable security definer as $$
  select coalesce(jsonb_agg(t order by t."sortOrder", t."title"), '[]'::jsonb)
  from (
    select
      s.id as "skillId",
      s.slug,
      s.title,
      coalesce(s.description, '') as "description",
      coalesce(s.category, '') as "category",
      s.sort_order as "sortOrder",
      (
        select count(*)::int from learning_resources r
        where r.skill_id = s.id and r.status = 'published'
          and (
            r.scope = 'platform'
            or exists (
              select 1 from resource_class_visibility v
              join cohort_members m on m.cohort_id = v.cohort_id and m.user_id = auth.uid() and m.role = 'student'
              join cohorts c on c.id = v.cohort_id and c.is_active::text in ('true', '1')
              where v.resource_id = r.id
            )
          )
      ) as "resourceCount",
      (
        select count(*)::int from resource_progress p
        join learning_resources r on r.id = p.resource_id
        where r.skill_id = s.id and r.status = 'published'
          and p.user_id = auth.uid() and p.completed_at is not null
      ) as "completedCount"
    from skills s
    where s.status = 'active'
  ) t;
$$;


revoke all on function skill_catalog_student() from public, anon;
grant execute on function skill_catalog_student() to authenticated;


-- 4.2 resource_list_student 扩展：输出 skillId 与 completedAt（新增 jsonb 键，不破坏既有调用方）
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
      r.skill_id as "skillId",
      p.position_seconds as "positionSeconds",
      p.completed_at as "completedAt",
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


-- 4.3 resource_get_student 扩展：输出 skillId 与 completedAt
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
    'skillId', v_resource.skill_id,
    'updatedAt', v_resource.updated_at,
    'positionSeconds', (
      select p.position_seconds from resource_progress p
      where p.resource_id = p_resource_id and p.user_id = v_user
    ),
    'completedAt', (
      select p.completed_at from resource_progress p
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


-- 4.4 resource_progress_upsert 扩展：保存断点后，观看位置达资源时长 90% 自动标记完成（幂等，completed_at 仅前进不回退）
create or replace function resource_progress_upsert(p_resource_id uuid, p_position_seconds integer) returns jsonb
language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_resource record;
  v_visible boolean;
  v_completed boolean;
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

  -- 完成标记：时长已知且观看位置 >= 90% 时标记；completed_at 取首次达成时间（仅前进）
  v_completed := v_resource.duration_seconds is not null and v_resource.duration_seconds > 0
    and p_position_seconds * 10 >= v_resource.duration_seconds * 9;
  if v_completed then
    update resource_progress
    set completed_at = coalesce(completed_at, now()), updated_at = now()
    where user_id = v_user and resource_id = p_resource_id;
  end if;

  return jsonb_build_object(
    'resourceId', p_resource_id,
    'positionSeconds', p_position_seconds,
    'completed', v_completed,
    'completedAt', (select p.completed_at from resource_progress p where p.user_id = v_user and p.resource_id = p_resource_id),
    'updatedAt', (select p.updated_at from resource_progress p where p.user_id = v_user and p.resource_id = p_resource_id)
  );
end;
$$;


revoke all on function resource_progress_upsert(uuid, integer) from public, anon;
grant execute on function resource_progress_upsert(uuid, integer) to authenticated;


commit;
