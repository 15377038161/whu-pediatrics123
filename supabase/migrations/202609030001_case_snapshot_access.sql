begin;

-- 快照表访问收紧（新增迁移，不改历史）：
-- 1) case_snapshot_facts 全部命令（SELECT/INSERT/UPDATE/DELETE）仅教师（app_is_teacher）。
--    此前 authenticated 可读/可插的策略会导致：学生全表预读检查事实、投毒污染教学事实。
-- 2) 学生获取会话绑定的教学事实，仅能通过受控 RPC case_snapshot_get_facts：
--    校验登录、会话归属（本人会话）、版本绑定（state.sourceSnapshotVersion = 请求版本）、
--    病例匹配（state.caseId = 请求病例），返回该版本 facts（不含诊断/原文/媒体）。
-- 3) 服务端评分读取固定版本 answers 仍走教师链路或本 RPC 之外的 answers 表（教师专用，
--    本迁移不改 answers 策略）。
-- 函数体表名不带 schema 前缀，与既有 app_is_teacher() 的 SECURITY DEFINER 模式一致。

drop policy if exists case_snapshot_facts_select on case_snapshot_facts;
drop policy if exists case_snapshot_facts_insert on case_snapshot_facts;
drop policy if exists case_snapshot_facts_teacher_manage on case_snapshot_facts;

-- 教师全量维护（含读取、写入、修正）
create policy case_snapshot_facts_teacher on case_snapshot_facts
  for all to authenticated using (app_is_teacher()) with check (app_is_teacher());

-- 受控读取 RPC：会话所有者本人 + 版本绑定 + 病例匹配才返回 facts
create or replace function case_snapshot_get_facts(p_case_id text, p_version text, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_state jsonb;
  v_facts jsonb;
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
  select facts into v_facts from case_snapshot_facts
    where case_id = p_case_id and version = p_version;
  return v_facts;
end;
$$;

revoke all on function case_snapshot_get_facts(text, text, uuid) from public, anon;
grant execute on function case_snapshot_get_facts(text, text, uuid) to authenticated;

commit;
