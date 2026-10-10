begin;

-- 辅助检查 RPC 安全修复（新增迁移，不改历史迁移，不放宽任何权限）：
-- 缺陷（2026-10-11 安全探针实证，3 defect）：
--   D1 case_snapshot_get_test 仅验证归属/版本/病例，不验证已下单——未下单直调可读任意项目结果；
--   D2 case_snapshot_get_facts 在 orderedTests>0 后返回全部 sections.tests——一次下单暴露全部检查结果；
--   D3 目录 label 取冒号前段，「降钙素原 0.58 ng/mL：明显升高」类行会把数值带入目录（前缀不保证无答案）。
-- 修复原则：
--   1) 新增 case_snapshot_record_test_order：先幂等原子持久化下单（DB 先落 orderedTests），
--      再行级取结果——get_test 的已下单验证不产生死锁（下单不再依赖 get_facts 全文投影）；
--   2) get_test 增加「p_test_id ∈ state.orderedTests」验证（稳定 ID source-test-N 不变）；
--   3) get_facts 训练中一律剥离 tests 段（目录走 list_tests、结果走 get_test 行级）；
--      完成态复盘返回全文（原有语义保留）；
--   4) label 改为可信项目名白名单最长前缀匹配（通用医学检查名，非患者数据），
--      白名单与 src/domain/case.ts TRUSTED_TEST_NAMES 保持同步；未匹配行用「检查记录 N」。
-- 守卫保留（与既有 RPC 一致）：登录 + 会话归属本人（受保护 user_id 列）+ 版本绑定 + 病例匹配；
--   record_test_order 额外拒绝完成态写入；testId 必须在目录行数范围内。
-- 权限：全部 revoke public/anon，仅 authenticated（与既有 RPC 一致，不新增授权对象）。

-- ---- 1) 持久化下单：幂等原子追加 orderedTests（先记单后取结果，无死锁） ----
create or replace function case_snapshot_record_test_order(p_case_id text, p_version text, p_session_id uuid, p_test_id text)
returns jsonb
language plpgsql
volatile
security definer
as $$
declare
  v_row record;
  v_facts jsonb;
  v_lines text[];
  v_line text;
  v_count integer := 0;
  v_completed boolean;
  v_ordered jsonb;
begin
  if auth.uid() is null then
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
  -- 完成态拒绝写入（status + FINISH_SESSION 事件双条件，直改列不构成完成）
  v_completed := v_row.status = 'completed' and exists (
    select 1 from jsonb_array_elements(coalesce(v_row.state->'events', '[]'::jsonb)) as ev(obj)
    where ev.obj->>'type' = 'FINISH_SESSION'
  );
  if v_completed then
    return null;
  end if;
  -- testId 合法性：格式 + 索引在目录行数范围内（与 list_tests 行解析规则一致）
  if p_test_id !~ '^source-test-\d+$' then
    return null;
  end if;
  select facts into v_facts from case_snapshot_facts
    where case_id = p_case_id and version = p_version;
  if v_facts is null then
    return null;
  end if;
  v_lines := string_to_array(coalesce(v_facts->'sections'->>'tests', ''), chr(10));
  foreach v_line in array v_lines loop
    v_line := btrim(v_line);
    if v_line = '' or v_line ~ '^(辅助检查|辅检|入院后辅检)[：:]$' then
      continue;
    end if;
    v_count := v_count + 1;
  end loop;
  if substring(p_test_id from '\d+')::int >= v_count then
    return null;
  end if;
  -- 幂等原子追加（行级 UPDATE，已存在不重复；不触碰 stage/版本/归属，既有触发器全部放行）
  update training_sessions
    set state = jsonb_set(state, '{orderedTests}', coalesce(state->'orderedTests', '[]'::jsonb) || to_jsonb(p_test_id))
    where id = p_session_id
      and not coalesce(state->'orderedTests', '[]'::jsonb) ? p_test_id;
  select coalesce(state->'orderedTests', '[]'::jsonb) into v_ordered from training_sessions where id = p_session_id;
  return v_ordered;
end;
$$;

revoke all on function case_snapshot_record_test_order(text, text, uuid, text) from public, anon;
grant execute on function case_snapshot_record_test_order(text, text, uuid, text) to authenticated;

-- ---- 2) 行级结果：新增「已下单」验证（稳定 ID source-test-N 不变）+ 白名单 label ----
create or replace function case_snapshot_get_test(p_case_id text, p_version text, p_session_id uuid, p_test_id text)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
  v_facts jsonb;
  v_lines text[];
  v_line text;
  v_norm text;
  v_label text;
  v_match text;
  v_name text;
  v_id text;
  v_index integer := 0;
  v_whitelist text[] := array[
    '血常规','血常规五分类','C反应蛋白','超敏C反应蛋白','CRP','降钙素原','PCT','血沉','红细胞沉降率',
    '血生化','肝功能','肾功能','电解质','血糖','血气分析','血气','心肌酶','心肌酶谱','肌钙蛋白','脑钠肽','BNP',
    '铁蛋白','维生素D','微量元素','甲状腺功能','甲功','皮质醇','生长激素','胰岛素样生长因子','胰岛素',
    '免疫球蛋白','IgE','IgG','IgA','IgM','补体','淋巴细胞亚群','T细胞亚群','自身抗体','抗核抗体','类风湿因子',
    '抗链球菌溶血素O','结核菌素试验','PPD试验','T-SPOT','痰培养','血培养','咽拭子培养','尿常规','便常规',
    '大便常规','大便隐血','脑脊液','骨髓','骨髓细胞学','胸片','胸部正位片','胸部X线','X线片','胸部CT','头颅CT',
    'CT','核磁共振','MRI','头颅MRI','B超','超声','腹部超声','泌尿系超声','心脏彩超','超声心动图','心电图',
    'ECG','脑电图','EEG','动态心电图','肺功能','支气管镜','胃镜','肠镜','过敏原','食物过敏原','吸入过敏原',
    '遗传代谢筛查','基因检测','染色体','血氨','乳酸','血乳酸','凝血功能','凝血四项','D二聚体','同型半胱氨酸'
  ];
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
  -- 已下单验证：p_test_id 必须已在持久化 orderedTests 中（先 record_test_order 后 get_test）
  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_row.state->'orderedTests', '[]'::jsonb)) as o(tid)
    where o.tid = p_test_id
  ) then
    return null;
  end if;
  select facts into v_facts from case_snapshot_facts
    where case_id = p_case_id and version = p_version;
  if v_facts is null then
    return null;
  end if;
  v_lines := string_to_array(coalesce(v_facts->'sections'->>'tests', ''), chr(10));
  foreach v_line in array v_lines loop
    v_line := btrim(v_line);
    if v_line = '' or v_line ~ '^(辅助检查|辅检|入院后辅检)[：:]$' then
      continue;
    end if;
    v_id := 'source-test-' || v_index;
    if v_id = p_test_id then
      -- 白名单最长前缀匹配（与 src/domain/case.ts trustedTestLabel 同规则）：
      -- 先剥离行首序号，再取白名单内最长前缀；未匹配用「检查记录 N」——目录/结果均不透出数值与结论
      v_norm := regexp_replace(v_line, '^[一二三四五六七八九十\d]+[、.．]\s*', '');
      v_label := null;
      foreach v_name in array v_whitelist loop
        if v_norm like v_name || '%' and (v_label is null or length(v_name) > length(v_label)) then
          v_label := v_name;
        end if;
      end loop;
      if v_label is null then
        v_label := '检查记录 ' || (v_index + 1);
      end if;
      return jsonb_build_object('id', v_id, 'label', v_label, 'result', v_line);
    end if;
    v_index := v_index + 1;
  end loop;
  return null;
end;
$$;

revoke all on function case_snapshot_get_test(text, text, uuid, text) from public, anon;
grant execute on function case_snapshot_get_test(text, text, uuid, text) to authenticated;

-- ---- 3) 无答案目录：label 改白名单匹配（冒号前缀不保证无答案） ----
create or replace function case_snapshot_list_tests(p_case_id text, p_version text, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
  v_facts jsonb;
  v_lines text[];
  v_line text;
  v_norm text;
  v_label text;
  v_name text;
  v_items jsonb := '[]'::jsonb;
  v_index integer := 0;
  v_whitelist text[] := array[
    '血常规','血常规五分类','C反应蛋白','超敏C反应蛋白','CRP','降钙素原','PCT','血沉','红细胞沉降率',
    '血生化','肝功能','肾功能','电解质','血糖','血气分析','血气','心肌酶','心肌酶谱','肌钙蛋白','脑钠肽','BNP',
    '铁蛋白','维生素D','微量元素','甲状腺功能','甲功','皮质醇','生长激素','胰岛素样生长因子','胰岛素',
    '免疫球蛋白','IgE','IgG','IgA','IgM','补体','淋巴细胞亚群','T细胞亚群','自身抗体','抗核抗体','类风湿因子',
    '抗链球菌溶血素O','结核菌素试验','PPD试验','T-SPOT','痰培养','血培养','咽拭子培养','尿常规','便常规',
    '大便常规','大便隐血','脑脊液','骨髓','骨髓细胞学','胸片','胸部正位片','胸部X线','X线片','胸部CT','头颅CT',
    'CT','核磁共振','MRI','头颅MRI','B超','超声','腹部超声','泌尿系超声','心脏彩超','超声心动图','心电图',
    'ECG','脑电图','EEG','动态心电图','肺功能','支气管镜','胃镜','肠镜','过敏原','食物过敏原','吸入过敏原',
    '遗传代谢筛查','基因检测','染色体','血氨','乳酸','血乳酸','凝血功能','凝血四项','D二聚体','同型半胱氨酸'
  ];
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
  if v_facts is null then
    return null;
  end if;
  v_lines := string_to_array(coalesce(v_facts->'sections'->>'tests', ''), chr(10));
  foreach v_line in array v_lines loop
    v_line := btrim(v_line);
    if v_line = '' or v_line ~ '^(辅助检查|辅检|入院后辅检)[：:]$' then
      continue;
    end if;
    v_norm := regexp_replace(v_line, '^[一二三四五六七八九十\d]+[、.．]\s*', '');
    v_label := null;
    foreach v_name in array v_whitelist loop
      if v_norm like v_name || '%' and (v_label is null or length(v_name) > length(v_label)) then
        v_label := v_name;
      end if;
    end loop;
    if v_label is null then
      v_label := '检查记录 ' || (v_index + 1);
    end if;
    v_items := v_items || jsonb_build_object('id', 'source-test-' || v_index, 'label', v_label);
    v_index := v_index + 1;
  end loop;
  return v_items;
end;
$$;

revoke all on function case_snapshot_list_tests(text, text, uuid) from public, anon;
grant execute on function case_snapshot_list_tests(text, text, uuid) to authenticated;

-- ---- 4) facts 投影：训练中一律剥离 tests（一次下单不再暴露全部全文） ----
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
  v_has_exam boolean;
  v_completed boolean;
begin
  if auth.uid() is null then
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
  select facts into v_facts from case_snapshot_facts
    where case_id = p_case_id and version = p_version;
  if v_facts is null then
    return null;
  end if;
  v_state := coalesce(v_row.state, '{}'::jsonb);
  v_evidence := coalesce(v_state->'unlockedEvidence', '[]'::jsonb);
  v_has_exam := exists (
    select 1 from jsonb_array_elements_text(v_evidence) as e(code)
    where e.code like 'SOURCE_EX_%' or e.code like 'EX_%'
  );
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
  -- 训练中：查体事实按真实查体证据投影（不变）；
  -- 检查事实一律剥离——目录走 list_tests（无答案），结果走 get_test（行级+已下单验证），
  -- 修复「一次下单后 orderedTests>0 即返回全部 tests 全文」的泄露（D2）。
  if not v_has_exam then
    v_sections := v_sections - 'exam';
  end if;
  v_sections := v_sections - 'tests';
  v_sections := v_sections - 'diagnosis' - 'plan';
  return jsonb_set(v_facts, '{sections}', v_sections);
end;
$$;

revoke all on function case_snapshot_get_facts(text, text, uuid) from public, anon;
grant execute on function case_snapshot_get_facts(text, text, uuid) to authenticated;

commit;
