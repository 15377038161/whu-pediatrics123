begin;

-- 服务端评分对照读取（新增迁移，不改历史）：
-- 1) 学生 finish 生成报告需要"原病例诊断/诊疗经过对照"（answers 表内容，RLS 仅教师）。
--    新增受控 RPC case_snapshot_get_reference：校验登录 + 会话归属本人 + 版本绑定一致 + 病例匹配，
--    满足才返回该版本的 diagnosis/plan（不含原文分片 documents 与媒体 media URL）。
-- 2) 教师仍直读 case_snapshot_answers（RLS app_is_teacher 放行），无需本 RPC。
-- 3) 函数体表名不带 schema 前缀，与既有 case_snapshot_get_facts / app_is_teacher 的模式一致。

create or replace function case_snapshot_get_reference(p_case_id text, p_version text, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_state jsonb;
  v_answers record;
begin
  if auth.uid() is null then
    return null;
  end if;
  -- 会话必须存在
  select state into v_state from training_sessions where id = p_session_id;
  if v_state is null then
    return null;
  end if;
  -- 会话归属：仅本人
  if (v_state->>'userId')::uuid is distinct from auth.uid() then
    return null;
  end if;
  -- 版本绑定：会话绑定的版本必须与请求版本一致
  if v_state->>'sourceSnapshotVersion' is distinct from p_version then
    return null;
  end if;
  -- 病例匹配：会话病例必须与请求病例一致
  if v_state->>'caseId' is distinct from p_case_id then
    return null;
  end if;
  select diagnosis, plan into v_answers from case_snapshot_answers
    where case_id = p_case_id and version = p_version;
  if v_answers is null then
    return null;
  end if;
  return jsonb_build_object('diagnosis', v_answers.diagnosis, 'plan', v_answers.plan);
end;
$$;

revoke all on function case_snapshot_get_reference(text, text, uuid) from public, anon;
grant execute on function case_snapshot_get_reference(text, text, uuid) to authenticated;

commit;
