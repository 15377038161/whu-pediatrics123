begin;

-- 学生错题复盘 RPC（新增迁移，不改已执行历史）：
-- quiz_review_mine：学生读取自己的作答记录 + 对应题目投影。
--   - 题干/选项：始终返回（学生已被分配该题，取题时本就见过）。
--   - answer/explanation：仅 answered_at 非空（已作答）才返回——首次提交前不能取答案。
--   - 归属：auth.uid() = user_id（本人记录）。
-- 与 quiz_fetch_questions（取题）/ quiz_submit_answer（判分）构成完整闭环。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名不带前缀，与既有模式一致。

create or replace function quiz_review_mine()
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  select coalesce(jsonb_agg(t.*), '[]'::jsonb) into v_rows
  from (
    select
      a.question_id,
      q.case_id,
      q.stem,
      q.options,
      q.difficulty,
      a.submitted_answer,
      a.is_correct,
      a.answered_at,
      case when a.answered_at is not null then q.answer end as answer,
      case when a.answered_at is not null then q.explanation end as explanation
    from quiz_assignments a
    join quiz_questions q on q.id = a.question_id
    where a.user_id = auth.uid()
    order by a.assigned_at asc
  ) t;
  return v_rows;
end;
$$;

revoke all on function quiz_review_mine() from public, anon;
grant execute on function quiz_review_mine() to authenticated;

commit;
