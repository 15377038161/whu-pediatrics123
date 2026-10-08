begin;

-- facts 阶段投影（新增迁移，不改已执行历史）：
-- 1) case_snapshot_get_facts 按 training_sessions 受保护 stage 列投影：
--    - history 阶段：仅返回 history section（问诊所需）；
--    - exam 阶段：history + exam；tests 阶段：history + exam + tests；
--    - assessment/plan/communication：全量 sections（已过完问诊查体检查）；
--    - diagnosis/plan sections 在非 report 阶段一律剥离（诊断对照走 get_reference 完成门控）。
-- 2) training_sessions guard 触发器补 stage 单向有序：每次最多前进一格，
--    禁止回退与跳跃（学生直改 state->stage 绕过投影需逐格推进且留下持久副作用）。
-- 已知边界（如实记录）：学生 owner_update 可逐格直推 stage，最终在 report 阶段
-- 读到全量 facts；等价于"提前交卷看解析"（finish 本身就是合法教学路径，
-- 代价是 status 单向锁死会话），不构成越权访问他人数据。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名不带前缀。

create or replace function case_snapshot_get_facts(p_case_id text, p_version text, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
  v_facts jsonb;
  v_stage text;
  v_stage_idx integer;
  v_sections jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  -- 归属：受保护 user_id 列；stage 用受保护 stage 列（guard 触发器保证单向有序）
  select user_id, status, stage, state into v_row from training_sessions where id = p_session_id;
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
  -- 阶段投影（依据受保护 stage 列；已完成会话全量供复盘）
  v_stage := coalesce(v_row.stage, 'history');
  v_stage_idx := case v_stage
    when 'history' then 1
    when 'exam' then 2
    when 'tests' then 3
    when 'assessment' then 4
    when 'plan' then 5
    when 'communication' then 6
    when 'report' then 7
    else 1
  end;
  v_sections := coalesce(v_facts->'sections', '{}'::jsonb);
  if v_row.status = 'completed' then
    v_sections := v_sections || jsonb_build_object('diagnosis', '', 'plan', '');
    return jsonb_set(v_facts, '{sections}', v_sections);
  end if;
  if v_stage_idx < 3 then
    -- history/exam 阶段：剥离 tests
    v_sections := v_sections - 'tests';
  end if;
  if v_stage_idx < 2 then
    -- history 阶段：剥离 exam
    v_sections := v_sections - 'exam';
  end if;
  -- 诊断/计划对照永不从 facts 返回（走 get_reference 完成门控）
  v_sections := v_sections - 'diagnosis' - 'plan';
  return jsonb_set(v_facts, '{sections}', v_sections);
end;
$$;

revoke all on function case_snapshot_get_facts(text, text, uuid) from public, anon;
grant execute on function case_snapshot_get_facts(text, text, uuid) to authenticated;

-- ---- guard 触发器补 stage 单向有序 ----
create or replace function training_sessions_guard()
returns trigger
language plpgsql
as $$
declare
  v_order text[] := array['history','exam','tests','assessment','plan','communication','report'];
  v_old_idx integer;
  v_new_idx integer;
begin
  if new.user_id is distinct from old.user_id
    or new.case_id is distinct from old.case_id
    or new.case_version is distinct from old.case_version
    or new.cohort_id is distinct from old.cohort_id then
    raise exception 'SESSION_BINDING_IMMUTABLE';
  end if;
  if old.status = 'completed' and new.status is distinct from 'completed' then
    raise exception 'SESSION_STATUS_REGRESSION';
  end if;
  if old.status = 'report_pending' and new.status = 'active' then
    raise exception 'SESSION_STATUS_REGRESSION';
  end if;
  -- stage 单向且每次最多前进一格（禁止回退与跳跃）
  v_old_idx := array_position(v_order, old.stage);
  v_new_idx := array_position(v_order, new.stage);
  if v_old_idx is not null and v_new_idx is not null then
    if v_new_idx < v_old_idx then
      raise exception 'SESSION_STAGE_REGRESSION';
    end if;
    if v_new_idx > v_old_idx + 1 then
      raise exception 'SESSION_STAGE_SKIP_FORBIDDEN';
    end if;
  end if;
  if (old.state->>'sourceSnapshotVersion') is not null
    and (new.state->>'sourceSnapshotVersion') is distinct from (old.state->>'sourceSnapshotVersion') then
    raise exception 'SESSION_SNAPSHOT_BINDING_IMMUTABLE';
  end if;
  if (old.state->>'caseId') is not null
    and (new.state->>'caseId') is distinct from (old.state->>'caseId') then
    raise exception 'SESSION_SNAPSHOT_BINDING_IMMUTABLE';
  end if;
  return new;
end;
$$;

commit;
