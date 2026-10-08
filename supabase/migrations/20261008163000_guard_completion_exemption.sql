begin;

-- guard 触发器完成豁免（新增迁移，不改已执行历史）：
-- FINISH_SESSION 会把 stage 直接置为 'report'（合法完成路径，可能从 plan 跳 2 格）。
-- 防跳级规则仅约束 active 会话的单步推进；status='completed' 的完成更新允许进入 report。
-- 注：平台 SQL 守卫禁止在函数内 SET search_path；表名不带前缀，与既有模式一致。

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
  -- 防跳级：仅约束 active 会话的单步推进；完成更新（new.status='completed'）允许进入 report
  if new.status = 'active' then
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
