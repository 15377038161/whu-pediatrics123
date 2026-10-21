begin;

-- 阶段 E 补充迁移：教师学情首页数据源与归属期间可见性收口。
-- 1) teacher_student_index()：教师自建班级的 cohort_members 直读受旧 permissive 策略
--    （memberships_related_read 依赖 is_teacher_for_user 的默认班级教师成员关系）限制，
--    学情首页的班级清单与学生当前归属映射经 security definer 聚合出口提供。
-- 2) app_can_view_student 扩展为归属期间感知：学生一次换班离开后，原班教师对
--    「归属其班级期间」产生的训练保留只读（方案 10.5）；会话/报告等行级可见性
--    由 class_period_* restrictive 策略（迁移 20261021000000）按时间锚点进一步收紧。

-- ============================================================
-- 1) app_can_view_student：叠加历史归属分支（不删原当前成员分支）
-- ============================================================
create or replace function app_can_view_student(p_user_id uuid) returns boolean language sql stable security definer as $$
  select app_is_teacher() and (
    app_is_project_admin()
    or exists (
      select 1 from cohort_members m join cohorts c on c.id=m.cohort_id
      where m.user_id=p_user_id and m.role='student' and c.is_active::text in ('true','1') and c.owner_id=auth.uid()
    )
    or exists (
      select 1 from class_membership_history h
      where h.user_id=p_user_id and h.to_cohort_id is not null
        and exists (select 1 from cohorts c where c.id=h.to_cohort_id and c.owner_id=auth.uid())
    )
  );
$$;

-- ============================================================
-- 2) teacher_student_index()：学情首页受控数据源
--    返回教师管理（含项目管理员代管）的启用班级清单，
--    以及学生在这些班级中的当前归属映射（user_id -> {cohortId, cohortName}）。
--    只读聚合，不含训练数据本身（训练行可见性仍由 RLS 决定）。
-- ============================================================
create or replace function teacher_student_index() returns jsonb
language sql stable security definer as $$
  select case when app_is_teacher() then jsonb_build_object(
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'memberCount', m.cnt) order by c.created_at desc)
      from cohorts c
      left join (
        select cohort_id, count(*) as cnt from cohort_members
        where role='student' group by cohort_id
      ) m on m.cohort_id=c.id
      where c.is_active::text in ('true','1') and c.owner_id is not null
        and (c.owner_id=auth.uid() or app_is_project_admin())
    ), '[]'::jsonb),
    'studentClasses', coalesce((
      select jsonb_object_agg(m.user_id::text, jsonb_build_object('cohortId', m.cohort_id, 'cohortName', c.name))
      from cohort_members m join cohorts c on c.id=m.cohort_id
      where m.role='student' and c.is_active::text in ('true','1') and c.owner_id is not null
        and (c.owner_id=auth.uid() or app_is_project_admin())
    ), '{}'::jsonb)
  ) else jsonb_build_object('classes', '[]'::jsonb, 'studentClasses', '{}'::jsonb) end;
$$;

revoke all on function teacher_student_index() from public, anon;
grant execute on function teacher_student_index() to authenticated;

commit;
