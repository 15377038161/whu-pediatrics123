begin;

-- 补偿迁移：恢复 tests 段 orderedTests 门控（撤销 20261015090000 的放宽）。
-- 背景：20261015090000 将 v_has_tests 从“orderedTests 非空”放宽为“已执行查体证据（v_has_exam）”，
--   意图修复“开单依赖目录、目录又被已开单门控剥离”的循环依赖。但该放宽使本人 token 可在
--   仅查体、未开单时经 RPC 读到 sections.tests 全文（含检查结果文本），属于未经授权扩大
--   数据可见范围——RPC 由本人 token 直接调用，前端仅显示目录/服务端缓存不能证明不泄露。
-- 本迁移恢复 20261010120000 的原门控：v_has_tests := jsonb_array_length(v_ordered) > 0。
-- 保留不变（与 20261010120000 完全一致）：
--   - 归属校验（受保护 user_id 列 = auth.uid()）、版本绑定校验、病例匹配校验；
--   - 完成态门控（status='completed' 且 state 内存在 FINISH_SESSION 事件）；
--   - exam 段按真实查体证据投影、diagnosis/plan 永不从 facts 返回；
--   - 函数权限（revoke public/anon，仅 authenticated）。
-- 不删除任何数据，不修改历史迁移文件。
-- 已知未决问题（如实记录，不在本迁移处理）：orderedTests 死锁——学生无法开出第一张检查单
--   （目录被门控剥离而开单依赖目录）。合法修复方案（目录/结果分离）需用户授权后另行实施，
--   见验收记录「检查目录与结果分离设计（待授权）」。

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
  -- 检查事实：要求真实开具过辅助检查（补偿迁移恢复原门控，撤销 20261015090000 的放宽）
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

commit;
