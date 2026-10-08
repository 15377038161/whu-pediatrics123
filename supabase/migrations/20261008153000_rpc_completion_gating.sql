begin;

-- RPC 完成态门控与受保护列（新增迁移，不改已执行历史）：
-- 1) case_snapshot_get_reference / case_snapshot_get_facts 的归属校验改用受保护的
--    training_sessions.user_id 数据库列（此前读 state->>'userId'，学生可改自己 state 伪造归属）。
-- 2) get_reference 增加完成态门控：仅 status='completed'（受保护列）才返回诊断对照。
--    训练中（active）直接调用 RPC 无法提前取答案。
-- 3) training_sessions 增加守卫触发器：
--    - 身份/绑定列（user_id/case_id/case_version/cohort_id）插入后不可变；
--    - state 内 sourceSnapshotVersion/caseId 一经绑定不可更改（防换患者/换版本串案）；
--    - status 单向：completed 不可回退 active（学生读对照的代价是永久结束该会话）。
-- 4) training_reports 撤销 owner_update：报告分数一经写入不可被学生自行修改。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；函数体表名不带前缀，
--    与既有 app_is_teacher / quiz_fetch_questions 模式一致，经租户代理解析。

-- ---- 1) 归属校验改用受保护列 + 完成态门控 ----
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
  -- 归属：受保护 user_id 列（触发器保证不可变），不读 state
  select user_id, status, state into v_row from training_sessions where id = p_session_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then
    return null;
  end if;
  -- 完成态门控：仅已完成会话可取诊断对照（训练中/未完成返回 null）
  if v_row.status is distinct from 'completed' then
    return null;
  end if;
  -- 版本绑定 + 病例匹配（state 内字段由触发器保证一经绑定不可更改）
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

-- ---- 2) get_facts 归属校验同样改用受保护列 ----
create or replace function case_snapshot_get_facts(p_case_id text, p_version text, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
  v_facts jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  select user_id, state into v_row from training_sessions where id = p_session_id;
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
  return v_facts;
end;
$$;

revoke all on function case_snapshot_get_facts(text, text, uuid) from public, anon;
grant execute on function case_snapshot_get_facts(text, text, uuid) to authenticated;

-- ---- 3) training_sessions 守卫触发器 ----
create or replace function training_sessions_guard()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.case_id is distinct from old.case_id
    or new.case_version is distinct from old.case_version
    or new.cohort_id is distinct from old.cohort_id then
    raise exception 'SESSION_BINDING_IMMUTABLE';
  end if;
  -- status 单向：已完成不可回退（读对照的代价是永久结束会话）
  if old.status = 'completed' and new.status is distinct from 'completed' then
    raise exception 'SESSION_STATUS_REGRESSION';
  end if;
  if old.status = 'report_pending' and new.status = 'active' then
    raise exception 'SESSION_STATUS_REGRESSION';
  end if;
  -- state 内绑定版本/病例一经设定不可更改（旧会话首次补绑允许：old 为空）
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

drop trigger if exists training_sessions_guard_trigger on training_sessions;
create trigger training_sessions_guard_trigger
  before update on training_sessions
  for each row execute function training_sessions_guard();

-- ---- 4) 报告分数不可学生自改 ----
drop policy if exists reports_owner_update on training_reports;

commit;
