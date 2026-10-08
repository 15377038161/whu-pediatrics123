begin;

-- OSCE 诊断对照 fail-closed 收紧（新增迁移，不改已执行历史）：
-- 背景（本轮真实用户实测取证，见 docs/security-status.md「组合伪造攻击实测」）：
--   学生可经 owner_update 直改 training_sessions.status='completed' 与 state.events（两项条件
--   均在学生可写范围内），组合伪造后 case_snapshot_get_reference 的双条件门控失效，
--   提前取到 diagnosis/plan（两变体均 LEAKED 实证）。平台 Data API 层无法区分应用服务端
--   finish 路由与学生直调（同样持有用户 JWT），双条件门控在当前平台权限模型下不可信。
-- 收紧（fail-closed）：
--   1) case_snapshot_get_reference 不再对学生返回任何内容：函数内教师判定（app_is_teacher）
--      不通过一律返回 null。诊断/处置对照从此仅教师可读（RLS 直读 case_snapshot_answers）。
--   2) 学生 finish 路由的评分对照留空（资料不足），不影响过程分，应用侧降级路径已确认不崩溃。
--   3) 教师既有权限完全不变：RLS 直读 case_snapshot_answers（app_is_teacher 放行）保留。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名/函数名不带前缀。
-- 待平台提供可信服务端写通道（评分安全选项 A/B）后再恢复学生侧完成态对照。

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
  -- fail-closed：仅教师可取诊断对照（学生组合伪造 status+events 后调用一律 null）。
  -- 完成态门控（status + FINISH_SESSION 双条件）已实证两项均可由学生伪造，不再作为授权依据。
  if not app_is_teacher() then
    return null;
  end if;
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
