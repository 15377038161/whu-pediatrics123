begin;

-- 题库续答语义修复（新增迁移，不改历史；2026-10-17 收紧轮第二阶段实测发现）：
-- 缺陷取证：quiz_fetch_questions 仅分发「未分配」题目——学生取题后未答完（页面刷新/离开），
--   已分配未作答题目永久搁浅（演示学生实况：43 已分配/2 已作答，41 题不可再取，
--   取题返回 poolExhausted=true 假空态）。旧 main 分支实现同此缺陷（同为仅排除已分配）。
-- 修复语义：取题优先返回本人「已分配未作答」题目（按 assigned_at 升序，批次内先到先续答），
--   不足 p_count 再随机分发未分配新题补足；仅新题写分配记录（幂等 on conflict do nothing）。
--   池耗尽（poolExhausted）自此语义为真：无未作答已分配题且无未分配新题。
-- 安全不变：SECURITY DEFINER + 登录校验；投影仍不含 answer/explanation；
--   归属仍 auth.uid()；不放宽任何权限，不改 quiz_submit_answer 判分幂等语义。

create or replace function quiz_fetch_questions(p_count integer)
returns jsonb
language plpgsql
volatile
security definer
as $$
declare
  v_user uuid := auth.uid();
  v_unanswered jsonb;
  v_fresh jsonb;
begin
  if v_user is null then
    return null;
  end if;
  if p_count is null or p_count < 1 or p_count > 20 then
    raise exception 'INVALID_COUNT';
  end if;
  -- 1) 本人已分配未作答题目（续答优先，assigned_at 升序）
  select coalesce(jsonb_agg(t.*), '[]'::jsonb) into v_unanswered
  from (
    select q.id, q.case_id, q.stem, q.options, q.difficulty
    from quiz_assignments a
    join quiz_questions q on q.id = a.question_id
    where a.user_id = v_user
      and a.answered_at is null
      and q.status = 'available'
    order by a.assigned_at asc
    limit p_count
  ) t;
  -- 2) 不足 p_count 时随机分发未分配新题补足（与旧语义一致）
  if jsonb_array_length(v_unanswered) < p_count then
    select coalesce(jsonb_agg(t.*), '[]'::jsonb) into v_fresh
    from (
      select q.id, q.case_id, q.stem, q.options, q.difficulty
      from quiz_questions q
      where q.status = 'available'
        and not exists (
          select 1 from quiz_assignments a
          where a.user_id = v_user and a.question_id = q.id
        )
      order by random()
      limit p_count - jsonb_array_length(v_unanswered)
    ) t;
  else
    v_fresh := '[]'::jsonb;
  end if;
  if v_unanswered = '[]'::jsonb and v_fresh = '[]'::jsonb then
    return null;
  end if;
  -- 仅新分发题目写分配记录（复合主键 (user_id, question_id) 去重；忽略已存在）
  insert into quiz_assignments (user_id, question_id)
  select v_user, (item->>'id')::uuid
  from jsonb_array_elements(v_fresh) as item
  on conflict do nothing;
  return v_unanswered || v_fresh;
end;
$$;

revoke all on function quiz_fetch_questions(integer) from public, anon;
grant execute on function quiz_fetch_questions(integer) to authenticated;

commit;
