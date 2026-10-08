begin;

-- 题库安全整改（新增迁移，不改历史）：
-- 1) quiz_questions 现状：SELECT 策略 qual=true（登录可读全列，含 answer/explanation，学生可提前看答案）；
--    教师仅 INSERT 策略，无 UPDATE/DELETE。
-- 2) 收紧后：
--    - 学生不可直读 quiz_questions（无 SELECT 策略 = 全列拦截，answer/explanation 不暴露）。
--    - 学生取题走受控 RPC quiz_fetch_questions：登录 + 未分配题目随机分发 + 写分配记录，
--      仅返回不含 answer/explanation 的投影列。
--    - 学生判分走受控 RPC quiz_submit_answer：校验该题已分配给本人（quiz_assignments 归属），
--      返回 correct/answer/explanation（作答后才可见）。
--    - 教师全量维护（读/写/改/删，走 app_is_teacher）。
-- 3) quiz_assignments 保持：本人读写（user_id = auth.uid()）；教师经 app_is_teacher 可读（新增 SELECT）。
-- 4) 函数体表名不带 schema 前缀，与既有 app_is_teacher / case_snapshot_get_facts 模式一致。

-- ---- quiz_questions：清旧宽松策略，重建 ----
drop policy if exists quiz_questions_user_select on quiz_questions;
drop policy if exists quiz_questions_teacher_insert on quiz_questions;

-- 教师全量维护
create policy quiz_questions_teacher on quiz_questions
  for all to authenticated using (app_is_teacher()) with check (app_is_teacher());

-- ---- quiz_assignments：教师补只读 ----
create policy quiz_assignments_teacher_select on quiz_assignments
  for select to authenticated using (app_is_teacher());

-- ---- 受控取题 RPC：随机分发未分配题目（不含答案列） ----
create or replace function quiz_fetch_questions(p_count integer)
returns jsonb
language plpgsql
volatile
security definer
as $$
declare
  v_user uuid := auth.uid();
  v_rows jsonb;
begin
  if v_user is null then
    return null;
  end if;
  if p_count is null or p_count < 1 or p_count > 20 then
    raise exception 'INVALID_COUNT';
  end if;
  -- 随机取未被本人分配的可用题目（投影：不含 answer/explanation）
  select coalesce(jsonb_agg(t.*), '[]'::jsonb) into v_rows
  from (
    select q.id, q.case_id, q.stem, q.options, q.difficulty
    from quiz_questions q
    where q.status = 'available'
      and not exists (
        select 1 from quiz_assignments a
        where a.user_id = v_user and a.question_id = q.id
      )
    order by random()
    limit p_count
  ) t;
  if v_rows = '[]'::jsonb then
    return null;
  end if;
  -- 写分配记录（复合主键 (user_id, question_id) 去重；忽略已存在）
  insert into quiz_assignments (user_id, question_id)
  select v_user, (item->>'id')::uuid
  from jsonb_array_elements(v_rows) as item
  on conflict do nothing;
  return v_rows;
end;
$$;

revoke all on function quiz_fetch_questions(integer) from public, anon;
grant execute on function quiz_fetch_questions(integer) to authenticated;

-- ---- 受控判分 RPC：仅已分配本人的题目可判分，作答后返回答案与解析 ----
create or replace function quiz_submit_answer(p_question_id uuid, p_answer text)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_user uuid := auth.uid();
  v_assigned boolean;
  v_answer text;
  v_explanation text;
begin
  if v_user is null then
    return null;
  end if;
  if p_question_id is null or p_answer is null then
    raise exception 'INVALID_REQUEST';
  end if;
  -- 归属校验：该题必须已分配给本人（未分配的题目不可作答）
  select exists (
    select 1 from quiz_assignments
    where user_id = v_user and question_id = p_question_id
  ) into v_assigned;
  if not v_assigned then
    return jsonb_build_object('error', 'NOT_ASSIGNED');
  end if;
  select answer, explanation into v_answer, v_explanation
  from quiz_questions where id = p_question_id;
  if v_answer is null then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;
  return jsonb_build_object(
    'correct', p_answer = v_answer,
    'answer', v_answer,
    'explanation', v_explanation
  );
end;
$$;

revoke all on function quiz_submit_answer(uuid, text) from public, anon;
grant execute on function quiz_submit_answer(uuid, text) to authenticated;

commit;
