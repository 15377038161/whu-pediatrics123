begin;

-- 题库作答完整性（新增迁移，不改已执行历史）：
-- 1) 撤销 quiz_assignments 学生直插策略：学生此前可绕过受控取题 RPC 直接伪造分配
--    （自分配任意题目后调判分 RPC 提前获取答案）。收紧后分配只能由
--    quiz_fetch_questions（SECURITY DEFINER，随机分发+复合主键去重）写入。
-- 2) 作答记录列（submitted_answer/is_correct/answered_at）由判分 RPC 原子写入：
--    学生无 UPDATE 策略 = 无法直改正确率；首次提交结果终局，重复提交不覆盖不刷分。
-- 3) 教师维护策略（ALL via app_is_teacher）替代原 teacher_select，支持清理/重置。
-- 注：平台 SQL 守卫禁止在函数内 SET search_path；函数体表名不带前缀，
--    与既有 app_is_teacher / case_snapshot_get_facts 模式一致，经租户代理解析。

-- ---- quiz_assignments：撤销学生直插，补作答记录列 ----
drop policy if exists quiz_assignments_user_insert on quiz_assignments;

alter table quiz_assignments
  add column if not exists submitted_answer text,
  add column if not exists is_correct boolean,
  add column if not exists answered_at timestamptz;

-- ---- 教师维护（读+写+删，替换原仅读策略）----
drop policy if exists quiz_assignments_teacher_select on quiz_assignments;
create policy quiz_assignments_teacher on quiz_assignments
  for all to authenticated using (app_is_teacher()) with check (app_is_teacher());

-- ---- 判分 RPC 重写：归属校验 + 幂等 + 首次结果终局 ----
create or replace function quiz_submit_answer(p_question_id uuid, p_answer text)
returns jsonb
language plpgsql
volatile
security definer
as $$
declare
  v_user uuid := auth.uid();
  v_assigned boolean;
  v_answer text;
  v_explanation text;
  v_record record;
  v_updated boolean := false;
begin
  if v_user is null then
    return null;
  end if;
  if p_question_id is null or p_answer is null then
    raise exception 'INVALID_REQUEST';
  end if;
  -- 归属校验：该题必须已分配给本人
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
  -- 已作答（含复盘重看）：返回首次记录结果，不覆盖、不刷分
  select * into v_record from quiz_assignments
  where user_id = v_user and question_id = p_question_id;
  if v_record.answered_at is not null then
    return jsonb_build_object(
      'correct', v_record.is_correct,
      'answer', v_answer,
      'explanation', v_explanation,
      'alreadyAnswered', true,
      'submittedAnswer', v_record.submitted_answer
    );
  end if;
  -- 首次作答：原子写入（WHERE answered_at IS NULL 保证并发重复提交仅首个生效）
  update quiz_assignments
  set submitted_answer = p_answer,
      is_correct = (p_answer = v_answer),
      answered_at = now()
  where user_id = v_user and question_id = p_question_id and answered_at is null
  returning true into v_updated;
  if not v_updated then
    -- 并发竞争落败：读取已记录的首个结果
    select * into v_record from quiz_assignments
    where user_id = v_user and question_id = p_question_id;
    return jsonb_build_object(
      'correct', v_record.is_correct,
      'answer', v_answer,
      'explanation', v_explanation,
      'alreadyAnswered', true,
      'submittedAnswer', v_record.submitted_answer
    );
  end if;
  return jsonb_build_object(
    'correct', p_answer = v_answer,
    'answer', v_answer,
    'explanation', v_explanation,
    'alreadyAnswered', false
  );
end;
$$;

revoke all on function quiz_submit_answer(uuid, text) from public, anon;
grant execute on function quiz_submit_answer(uuid, text) to authenticated;

commit;
