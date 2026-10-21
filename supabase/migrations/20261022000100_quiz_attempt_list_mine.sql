begin;


-- 阶段 F 补充迁移：学生本人题库批次列表（统一报告列表数据源）。
-- question_banks 仅 owner/管理员可直读（标题对学生不可直读），批次记录虽可经 RLS
-- 直读（user_id = auth.uid()），但缺少题集标题与版本信息；经受控聚合出口统一提供。
-- 只读聚合：不含任何未作答题目的 answer/explanation（作答明细经 quiz_attempt_state 按需获取）。


create or replace function quiz_attempt_list_mine() returns jsonb
language sql stable security definer as $$
  select coalesce(jsonb_agg(t order by t."startedAt" desc), '[]'::jsonb)
  from (
    select
      a.id as "attemptId",
      a.bank_id as "bankId",
      coalesce(b.title, '已删除题集') as "bankTitle",
      coalesce(b.topic, '') as "topic",
      a.status,
      a.started_at as "startedAt",
      a.completed_at as "completedAt",
      v.version,
      v.item_count as "itemCount",
      (
        select count(*)::int from attempt_answers ans
        where ans.attempt_id = a.id
      ) as "answeredCount",
      (
        select count(*)::int from attempt_answers ans
        where ans.attempt_id = a.id and ans.is_correct
      ) as "correctCount"
    from quiz_attempts a
    join question_bank_versions v on v.id = a.version_id
    left join question_banks b on b.id = a.bank_id
    where a.user_id = auth.uid()
  ) t;
$$;


revoke all on function quiz_attempt_list_mine() from public, anon;
grant execute on function quiz_attempt_list_mine() to authenticated;


commit;
