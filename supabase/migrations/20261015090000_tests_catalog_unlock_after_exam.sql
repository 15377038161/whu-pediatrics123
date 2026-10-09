begin;

-- tests 目录解锁门控修正（新增迁移，不改已执行历史）：
-- 此前问题（真实平台回归实测定位，见 verify-session-scoped-restore.ts）：
--   v_has_tests := orderedTests 数组非空 —— 但开单依赖 tests 目录（caseOptions.tests 由
--   投影后的 sections.tests 解析），目录又被同一门控剥离 → 循环依赖：学生永远无法开出
--   第一张检查单，stage 无法进入 tests，DB 防跳级触发器随之拦截诊断/处置/沟通提交。
-- 修正：tests 目录与 exam 段同门（已执行真实查体操作）。安全等价性论证：
--   1) 投影结果仅进入服务端进程缓存（会话作用域键 sourceId@version#sessionId），
--      不直接返回客户端；客户端可见面是 caseOptions.tests 目录（id/label/indication，
--      无结果文本）；
--   2) 结果文本仅在学生真实开单（ORDER_TEST 经 handleTest）后才写入消息/证据链，
--      与 exam 段在 prep 证据后投影、真实查体动作后才输出结果的既有安全模式一致；
--   3) 完成态全量复盘与 get_reference 完成门控（双条件）不受本迁移影响。
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
  -- 检查目录：与 exam 段同门（已执行真实查体操作）。开单动作本身仍记录 orderedTests，
  -- 完成态复盘与评分对照按真实 orderedTests 判定，不因目录提前可见而变化。
  v_has_tests := v_has_exam;
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

commit;
