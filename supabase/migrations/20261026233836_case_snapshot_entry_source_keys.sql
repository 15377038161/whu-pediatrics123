BEGIN;

-- Tenant-bound platform migration. Do not set search_path or rewrite schema.ts.
-- The official executor must already select the exact tenant; otherwise fail closed.
-- Frozen source map mirrors TEACHER_CASE_LINKS; regression checks every branch.
-- No new RPC, role, table, policy, source data or historical session changes.
DO $tenant_guard$
BEGIN
  IF current_schema() IS DISTINCT FROM 'tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema' THEN
    RAISE EXCEPTION 'CASE_SNAPSHOT_TARGET_TENANT_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'case_snapshot_get_facts(text,text,uuid)',
      'case_snapshot_list_tests(text,text,uuid)',
      'case_snapshot_get_test(text,text,uuid,text)',
      'case_snapshot_get_reference(text,text,uuid)',
      'case_snapshot_record_test_order(text,text,uuid,text)'
    ]) AS expected(signature)
    WHERE to_regprocedure('"tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".' || expected.signature) IS NULL
  ) THEN
    RAISE EXCEPTION 'CASE_SNAPSHOT_RPC_BASELINE_MISSING';
  END IF;
END;
$tenant_guard$;

CREATE OR REPLACE FUNCTION case_snapshot_get_facts(p_case_id text, p_version text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
    where case_id = CASE p_case_id
      WHEN 'teacher-单纯肥胖症' THEN 'teacher-儿童-肥胖症'
      WHEN 'teacher-新生儿胎粪吸入肺炎' THEN 'teacher-新生儿胎粪吸入性肺炎'
      WHEN 'teacher-传染行单核细胞增多症' THEN 'teacher-传染性单核细胞增多症'
      WHEN 'teacher-婴儿胆汁淤积症-巨细胞病毒' THEN 'teacher-婴儿胆汁淤积症-巨细胞病毒感染'
      WHEN 'teacher-毛细支气管炎' THEN 'teacher-急性毛细支气管炎'
      WHEN 'teacher-大叶性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-肺炎支原体性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-心律失常-阵发性室上性心动过速' THEN 'teacher-心律失常-室上性心动过速'
      WHEN 'teacher-急性白血病' THEN 'teacher-急性白血病-急性淋巴细胞白血病'
      WHEN 'teacher-癫痫' THEN 'teacher-癫痫全面性发作阵挛性发作'
      WHEN 'teacher-先天性肌无力综合征' THEN 'teacher-先天性肌无力'
      WHEN 'teacher-生长激素缺乏症-矮小症' THEN 'teacher-矮小症'
      WHEN 'teacher-i型糖尿病伴有酮症酸中毒' THEN 'teacher-1型糖尿病伴有酮症酸中毒'
      WHEN 'teacher-糖原贮积病' THEN 'teacher-糖原贮积病iv型'
      ELSE p_case_id
    END and version = p_version;
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
$function$;

CREATE OR REPLACE FUNCTION case_snapshot_list_tests(p_case_id text, p_version text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
    where case_id = CASE p_case_id
      WHEN 'teacher-单纯肥胖症' THEN 'teacher-儿童-肥胖症'
      WHEN 'teacher-新生儿胎粪吸入肺炎' THEN 'teacher-新生儿胎粪吸入性肺炎'
      WHEN 'teacher-传染行单核细胞增多症' THEN 'teacher-传染性单核细胞增多症'
      WHEN 'teacher-婴儿胆汁淤积症-巨细胞病毒' THEN 'teacher-婴儿胆汁淤积症-巨细胞病毒感染'
      WHEN 'teacher-毛细支气管炎' THEN 'teacher-急性毛细支气管炎'
      WHEN 'teacher-大叶性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-肺炎支原体性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-心律失常-阵发性室上性心动过速' THEN 'teacher-心律失常-室上性心动过速'
      WHEN 'teacher-急性白血病' THEN 'teacher-急性白血病-急性淋巴细胞白血病'
      WHEN 'teacher-癫痫' THEN 'teacher-癫痫全面性发作阵挛性发作'
      WHEN 'teacher-先天性肌无力综合征' THEN 'teacher-先天性肌无力'
      WHEN 'teacher-生长激素缺乏症-矮小症' THEN 'teacher-矮小症'
      WHEN 'teacher-i型糖尿病伴有酮症酸中毒' THEN 'teacher-1型糖尿病伴有酮症酸中毒'
      WHEN 'teacher-糖原贮积病' THEN 'teacher-糖原贮积病iv型'
      ELSE p_case_id
    END and version = p_version;
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
$function$;

CREATE OR REPLACE FUNCTION case_snapshot_get_test(p_case_id text, p_version text, p_session_id uuid, p_test_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_row record;
  v_facts jsonb;
  v_lines text[];
  v_line text;
  v_norm text;
  v_label text;
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
    where case_id = CASE p_case_id
      WHEN 'teacher-单纯肥胖症' THEN 'teacher-儿童-肥胖症'
      WHEN 'teacher-新生儿胎粪吸入肺炎' THEN 'teacher-新生儿胎粪吸入性肺炎'
      WHEN 'teacher-传染行单核细胞增多症' THEN 'teacher-传染性单核细胞增多症'
      WHEN 'teacher-婴儿胆汁淤积症-巨细胞病毒' THEN 'teacher-婴儿胆汁淤积症-巨细胞病毒感染'
      WHEN 'teacher-毛细支气管炎' THEN 'teacher-急性毛细支气管炎'
      WHEN 'teacher-大叶性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-肺炎支原体性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-心律失常-阵发性室上性心动过速' THEN 'teacher-心律失常-室上性心动过速'
      WHEN 'teacher-急性白血病' THEN 'teacher-急性白血病-急性淋巴细胞白血病'
      WHEN 'teacher-癫痫' THEN 'teacher-癫痫全面性发作阵挛性发作'
      WHEN 'teacher-先天性肌无力综合征' THEN 'teacher-先天性肌无力'
      WHEN 'teacher-生长激素缺乏症-矮小症' THEN 'teacher-矮小症'
      WHEN 'teacher-i型糖尿病伴有酮症酸中毒' THEN 'teacher-1型糖尿病伴有酮症酸中毒'
      WHEN 'teacher-糖原贮积病' THEN 'teacher-糖原贮积病iv型'
      ELSE p_case_id
    END and version = p_version;
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
$function$;

CREATE OR REPLACE FUNCTION case_snapshot_get_reference(p_case_id text, p_version text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
    where case_id = CASE p_case_id
      WHEN 'teacher-单纯肥胖症' THEN 'teacher-儿童-肥胖症'
      WHEN 'teacher-新生儿胎粪吸入肺炎' THEN 'teacher-新生儿胎粪吸入性肺炎'
      WHEN 'teacher-传染行单核细胞增多症' THEN 'teacher-传染性单核细胞增多症'
      WHEN 'teacher-婴儿胆汁淤积症-巨细胞病毒' THEN 'teacher-婴儿胆汁淤积症-巨细胞病毒感染'
      WHEN 'teacher-毛细支气管炎' THEN 'teacher-急性毛细支气管炎'
      WHEN 'teacher-大叶性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-肺炎支原体性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-心律失常-阵发性室上性心动过速' THEN 'teacher-心律失常-室上性心动过速'
      WHEN 'teacher-急性白血病' THEN 'teacher-急性白血病-急性淋巴细胞白血病'
      WHEN 'teacher-癫痫' THEN 'teacher-癫痫全面性发作阵挛性发作'
      WHEN 'teacher-先天性肌无力综合征' THEN 'teacher-先天性肌无力'
      WHEN 'teacher-生长激素缺乏症-矮小症' THEN 'teacher-矮小症'
      WHEN 'teacher-i型糖尿病伴有酮症酸中毒' THEN 'teacher-1型糖尿病伴有酮症酸中毒'
      WHEN 'teacher-糖原贮积病' THEN 'teacher-糖原贮积病iv型'
      ELSE p_case_id
    END and version = p_version;
  if v_answers is null then
    return null;
  end if;
  return jsonb_build_object('diagnosis', v_answers.diagnosis, 'plan', v_answers.plan);
end;
$function$;

CREATE OR REPLACE FUNCTION case_snapshot_record_test_order(p_case_id text, p_version text, p_session_id uuid, p_test_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    where case_id = CASE p_case_id
      WHEN 'teacher-单纯肥胖症' THEN 'teacher-儿童-肥胖症'
      WHEN 'teacher-新生儿胎粪吸入肺炎' THEN 'teacher-新生儿胎粪吸入性肺炎'
      WHEN 'teacher-传染行单核细胞增多症' THEN 'teacher-传染性单核细胞增多症'
      WHEN 'teacher-婴儿胆汁淤积症-巨细胞病毒' THEN 'teacher-婴儿胆汁淤积症-巨细胞病毒感染'
      WHEN 'teacher-毛细支气管炎' THEN 'teacher-急性毛细支气管炎'
      WHEN 'teacher-大叶性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-肺炎支原体性肺炎' THEN 'teacher-肺炎支原体肺炎'
      WHEN 'teacher-心律失常-阵发性室上性心动过速' THEN 'teacher-心律失常-室上性心动过速'
      WHEN 'teacher-急性白血病' THEN 'teacher-急性白血病-急性淋巴细胞白血病'
      WHEN 'teacher-癫痫' THEN 'teacher-癫痫全面性发作阵挛性发作'
      WHEN 'teacher-先天性肌无力综合征' THEN 'teacher-先天性肌无力'
      WHEN 'teacher-生长激素缺乏症-矮小症' THEN 'teacher-矮小症'
      WHEN 'teacher-i型糖尿病伴有酮症酸中毒' THEN 'teacher-1型糖尿病伴有酮症酸中毒'
      WHEN 'teacher-糖原贮积病' THEN 'teacher-糖原贮积病iv型'
      ELSE p_case_id
    END and version = p_version;
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
$function$;

COMMIT;
