begin;

-- 班级积分榜最小数据入口：只返回当前班内学生，以及学生归属本班期间的
-- “学生 × 病例”最高有效临床分。sourceId 归一、跨别名取最高与同分排名在服务端领域层完成。
create or replace function class_leaderboard_scores(p_class_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_members jsonb;
  v_scores jsonb;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_class_id is null then raise exception 'INVALID_INPUT'; end if;

  if app_is_teacher() then
    if not app_manages_class(p_class_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  elsif not exists (
    select 1
    from student_class_state s
    join cohort_members m on m.user_id = s.user_id and m.cohort_id = s.current_cohort_id and m.role = 'student'
    join cohorts c on c.id = s.current_cohort_id
    where s.user_id = auth.uid()
      and s.current_cohort_id = p_class_id
      and s.onboarding_done
      and c.is_active::text in ('true','1')
      and c.owner_id is not null
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', p.id,
    'name', coalesce(nullif(trim(p.display_name), ''), '学生')
  ) order by p.display_name, p.id), '[]'::jsonb)
  into v_members
  from cohort_members m
  join profiles p on p.id = m.user_id
  where m.cohort_id = p_class_id
    and m.role = 'student'
    and p.account_kind <> 'test';

  with eligible_reports as (
    select r.user_id, r.case_id, r.total_score
    from training_reports r
    join cohort_members m on m.user_id = r.user_id and m.cohort_id = p_class_id and m.role = 'student'
    join profiles p on p.id = r.user_id and p.account_kind <> 'test'
    where app_member_at(r.user_id, p_class_id, r.created_at)
      and not (case
        when r.data ? 'unscored' then coalesce((r.data->>'unscored')::boolean, false)
        when jsonb_typeof(r.data->'evidence') = 'array'
          and exists (
            select 1 from jsonb_array_elements(r.data->'evidence') item
            where coalesce((item.value->>'maxScore')::numeric, 0) > 0
          )
        then not exists (
          select 1 from jsonb_array_elements(r.data->'evidence') item
          where coalesce((item.value->>'maxScore')::numeric, 0) > 0
            and coalesce(item.value->>'status', '') not in ('not_assessable', 'not_applicable')
        )
        else false
      end)
  ), best_by_case as (
    select user_id, case_id, max(total_score)::int as score
    from eligible_reports
    group by user_id, case_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', user_id,
    'caseId', case_id,
    'score', score
  ) order by user_id, case_id), '[]'::jsonb)
  into v_scores
  from best_by_case;

  return jsonb_build_object('members', v_members, 'scores', v_scores);
end;
$$;

-- === managed grants ===
revoke all on function class_leaderboard_scores(uuid) from public, anon, authenticated;
grant execute on function class_leaderboard_scores(uuid) to authenticated;

commit;
