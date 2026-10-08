begin;

-- OSCE 阶段化事实投影修正（新增迁移，不改已执行历史）：
-- 此前问题（本轮审计实测确认）：
--   1) case_snapshot_get_facts 的阶段投影读的是受保护 stage 列，但学生可经
--      owner_update 直改 stage 列逐格推进（guard 只限制"每次一格"），随后经 RPC
--      读到全量 facts —— 属"未经操作解锁事实"。本迁移改为：facts 投影依据
--      state 内的"已执行临床操作"证据（unlockedEvidence/orderedTests/decision/plan/
--      communication，由应用在真实操作后写入），不再依据 stage 列。
--      学生改 stage 列不再解锁任何额外事实。
--   2) case_snapshot_get_reference 的完成门控读受保护 status 列，但学生可经
--      owner_update 直改 status='completed'（guard 只禁回退）后调 RPC 提前取
--      诊断/处置对照。本迁移改为：完成门控同时要求 state 中存在 FINISH_SESSION
--      临床事件（finish 路由真实走 runAgentTurn 写入），直改 status 不再解锁对照。
-- 教师路径不受影响：教师仍走 RLS 直读 case_snapshot_facts / case_snapshot_answers。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名不带前缀。

-- ---- 1) facts 投影改依据"已执行操作证据" ----
create or replace function case_snapshot_get_facts(p_case_id text, p_version text, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
  v_facts jsonb;
  v_state jsonb;
  v_sections jsonb;
  v_evidence jsonb;
  v_ordered jsonb;
  v_has_exam boolean;
  v_has_tests boolean;
  v_completed boolean;
begin
  if auth.uid() is null then
    return null;
  end if;
  -- 归属：受保护 user_id 列（触发器保证不可变），不读 state->>'userId'
  select user_id, status, state into v_row from training_sessions where id = p_session_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then
    return null;
  end if;
  if v_row.state->>'sourceSnapshotVersion' is distinct from p_version then
    return null;
  end if;
  if v_row.state->>'caseId' is distinct from p_case_id then
    return null;
  end if;
  select facts into v_facts from case_snapshot_facts
    where case_id = p_case_id and version = p_version;
  if v_facts is null then
    return null;
  end if;
  v_state := coalesce(v_row.state, '{}'::jsonb);
  v_evidence := coalesce(v_state->'unlockedEvidence', '[]'::jsonb);
  v_ordered := coalesce(v_state->'orderedTests', '[]'::jsonb);
  -- 查体事实：要求真实执行过查体操作（SOURCE_EX_ / EX_ 证据，而非手卫生准备）
  v_has_exam := exists (
    select 1 from jsonb_array_elements_text(v_evidence) as e(code)
    where e.code like 'SOURCE_EX_%' or e.code like 'EX_%'
  );
  -- 检查事实：要求真实开具过辅助检查
  v_has_tests := jsonb_array_length(v_ordered) > 0;
  -- 完成会话：要求 state 内存在 FINISH_SESSION 事件（finish 路由真实写入），
  -- 直改 status 列不构成完成。
  v_completed := v_row.status = 'completed' and exists (
    select 1 from jsonb_array_elements(coalesce(v_state->'events', '[]'::jsonb)) as ev(obj)
    where ev.obj->>'type' = 'FINISH_SESSION'
  );

  v_sections := coalesce(v_facts->'sections', '{}'::jsonb);
  if v_completed then
    -- 已真实完成：全量复盘（diagnosis/plan 仍走 get_reference 的完成门控）
    v_sections := v_sections || jsonb_build_object('diagnosis', '', 'plan', '');
    return jsonb_set(v_facts, '{sections}', v_sections);
  end if;
  -- 训练中：按已执行操作投影（stage 列不再参与授权判定）
  if not v_has_exam then
    v_sections := v_sections - 'exam';
  end if;
  if not v_has_tests then
    v_sections := v_sections - 'tests';
  end if;
  -- 诊断/计划对照永不从 facts 返回（走 get_reference 完成门控）
  v_sections := v_sections - 'diagnosis' - 'plan';
  return jsonb_set(v_facts, '{sections}', v_sections);
end;
$$;

revoke all on function case_snapshot_get_facts(text, text, uuid) from public, anon;
grant execute on function case_snapshot_get_facts(text, text, uuid) to authenticated;

-- ---- 2) get_reference 完成门控补真实 FINISH_SESSION 事件要求 ----
create or replace function case_snapshot_get_reference(p_case_id text, p_version text, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
  v_answers record;
begin
  if auth.uid() is null then
    return null;
  end if;
  select user_id, status, state into v_row from training_sessions where id = p_session_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then
    return null;
  end if;
  -- 完成门控：受保护 status 列 + state 内真实 FINISH_SESSION 事件（双条件）。
  -- 学生直改 status='completed' 后调 RPC：无 FINISH_SESSION 事件，返回 null。
  if v_row.status is distinct from 'completed' then
    return null;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_row.state->'events', '[]'::jsonb)) as ev(obj)
    where ev.obj->>'type' = 'FINISH_SESSION'
  ) then
    return null;
  end if;
  if v_row.state->>'sourceSnapshotVersion' is distinct from p_version then
    return null;
  end if;
  if v_row.state->>'caseId' is distinct from p_case_id then
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
