BEGIN;
BEGIN;

-- Explicit, reviewed testDefinitions are authoritative when present. Legacy snapshots
-- without that contract retain the original sections.tests line parser.
-- All RPCs keep owner + entry + bound-version guards; results additionally require
-- a persisted order. Catalog rows expose only id/label/aliases, never result text.

CREATE OR REPLACE FUNCTION case_snapshot_list_tests(p_case_id text, p_version text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_row record;
  v_facts jsonb;
  v_config jsonb;
  v_source_id text;
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
    'PET/CT','CT','核磁共振','MRI','头颅MRI','B超','超声','腹部超声','泌尿系超声','心脏彩超','超声心动图','心电图',
    'ECG','脑电图','EEG','动态心电图','肺功能','支气管镜','胃镜','肠镜','过敏原','食物过敏原','吸入过敏原',
    '遗传代谢筛查','基因检测','染色体','血氨','乳酸','血乳酸','凝血功能','凝血四项','D二聚体','同型半胱氨酸'
  ];
begin
  if auth.uid() is null then return null; end if;
  select user_id, state into v_row from training_sessions where id = p_session_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then return null; end if;
  if v_row.state->>'sourceSnapshotVersion' is distinct from p_version then return null; end if;
  if v_row.state->>'caseId' is distinct from p_case_id then return null; end if;

  v_source_id := CASE p_case_id
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
  END;
  select f.facts, a.binding_config into v_facts, v_config
    from case_snapshot_facts f
    left join case_snapshot_answers a on a.case_id = f.case_id and a.version = f.version
    where f.case_id = v_source_id and f.version = p_version;
  if v_facts is null then return null; end if;

  if jsonb_typeof(v_config->'testDefinitions') = 'array'
    and jsonb_array_length(v_config->'testDefinitions') > 0 then
    select coalesce(jsonb_agg(
      jsonb_build_object('id', definition.item->>'testId', 'label', definition.item->>'label')
      || case when jsonb_typeof(definition.item->'aliases') = 'array'
        then jsonb_build_object('aliases', definition.item->'aliases') else '{}'::jsonb end
      order by definition.ordinality
    ), '[]'::jsonb) into v_items
    from jsonb_array_elements(v_config->'testDefinitions') with ordinality as definition(item, ordinality)
    where definition.item->>'testId' ~ '^source-test-\d+$'
      and jsonb_typeof(definition.item->'label') = 'string'
      and length(btrim(definition.item->>'label')) between 1 and 80;
    return v_items;
  end if;

  v_lines := string_to_array(coalesce(v_facts->'sections'->>'tests', ''), chr(10));
  foreach v_line in array v_lines loop
    v_line := btrim(v_line);
    if v_line = '' or v_line ~ '^(辅助检查|辅检|入院后辅检)[：:]$' then continue; end if;
    v_norm := regexp_replace(v_line, '^[一二三四五六七八九十\d]+[、.．]\s*', '');
    v_label := null;
    foreach v_name in array v_whitelist loop
      if v_norm like v_name || '%' and (v_label is null or length(v_name) > length(v_label)) then
        v_label := v_name;
      end if;
    end loop;
    if v_label is null then v_label := '检查记录 ' || (v_index + 1); end if;
    v_items := v_items || jsonb_build_object('id', 'source-test-' || v_index, 'label', v_label);
    v_index := v_index + 1;
  end loop;
  return v_items;
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
  v_config jsonb;
  v_source_id text;
  v_lines text[];
  v_line text;
  v_count integer := 0;
  v_completed boolean;
  v_ordered jsonb;
begin
  if auth.uid() is null then return null; end if;
  select user_id, status, state into v_row from training_sessions where id = p_session_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then return null; end if;
  if v_row.state->>'sourceSnapshotVersion' is distinct from p_version then return null; end if;
  if v_row.state->>'caseId' is distinct from p_case_id then return null; end if;
  v_completed := v_row.status = 'completed' and exists (
    select 1 from jsonb_array_elements(coalesce(v_row.state->'events', '[]'::jsonb)) as ev(obj)
    where ev.obj->>'type' = 'FINISH_SESSION'
  );
  if v_completed then return null; end if;
  if p_test_id !~ '^source-test-\d+$' then return null; end if;

  v_source_id := CASE p_case_id
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
  END;
  select f.facts, a.binding_config into v_facts, v_config
    from case_snapshot_facts f
    left join case_snapshot_answers a on a.case_id = f.case_id and a.version = f.version
    where f.case_id = v_source_id and f.version = p_version;
  if v_facts is null then return null; end if;

  if jsonb_typeof(v_config->'testDefinitions') = 'array'
    and jsonb_array_length(v_config->'testDefinitions') > 0 then
    if not exists (
      select 1 from jsonb_array_elements(v_config->'testDefinitions') as definition(item)
      where definition.item->>'testId' = p_test_id
    ) then return null; end if;
  else
    v_lines := string_to_array(coalesce(v_facts->'sections'->>'tests', ''), chr(10));
    foreach v_line in array v_lines loop
      v_line := btrim(v_line);
      if v_line = '' or v_line ~ '^(辅助检查|辅检|入院后辅检)[：:]$' then continue; end if;
      v_count := v_count + 1;
    end loop;
    if substring(p_test_id from '\d+')::int >= v_count then return null; end if;
  end if;

  update training_sessions
    set state = jsonb_set(state, '{orderedTests}', coalesce(state->'orderedTests', '[]'::jsonb) || to_jsonb(p_test_id))
    where id = p_session_id and not coalesce(state->'orderedTests', '[]'::jsonb) ? p_test_id;
  select coalesce(state->'orderedTests', '[]'::jsonb) into v_ordered from training_sessions where id = p_session_id;
  return v_ordered;
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
  v_config jsonb;
  v_source_id text;
  v_definition jsonb;
  v_release jsonb;
  v_media jsonb;
  v_stages text[] := ARRAY['triage','history','exam','tests','assessment','plan','communication','report'];
  v_lines text[];
  v_line text;
  v_result text;
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
    'PET/CT','CT','核磁共振','MRI','头颅MRI','B超','超声','腹部超声','泌尿系超声','心脏彩超','超声心动图','心电图',
    'ECG','脑电图','EEG','动态心电图','肺功能','支气管镜','胃镜','肠镜','过敏原','食物过敏原','吸入过敏原',
    '遗传代谢筛查','基因检测','染色体','血氨','乳酸','血乳酸','凝血功能','凝血四项','D二聚体','同型半胱氨酸'
  ];
begin
  if auth.uid() is null then return null; end if;
  select user_id, state into v_row from training_sessions where id = p_session_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then return null; end if;
  if v_row.state->>'sourceSnapshotVersion' is distinct from p_version then return null; end if;
  if v_row.state->>'caseId' is distinct from p_case_id then return null; end if;
  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_row.state->'orderedTests', '[]'::jsonb)) as o(tid)
    where o.tid = p_test_id
  ) then return null; end if;

  v_source_id := CASE p_case_id
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
  END;
  select f.facts, a.binding_config into v_facts, v_config
    from case_snapshot_facts f
    left join case_snapshot_answers a on a.case_id = f.case_id and a.version = f.version
    where f.case_id = v_source_id and f.version = p_version;
  if v_facts is null then return null; end if;

  if jsonb_typeof(v_config->'testDefinitions') = 'array'
    and jsonb_array_length(v_config->'testDefinitions') > 0 then
    select item into v_definition from jsonb_array_elements(v_config->'testDefinitions') as definition(item)
      where definition.item->>'testId' = p_test_id limit 1;
    if v_definition is null or jsonb_typeof(v_definition->'result') <> 'string'
      or btrim(v_definition->>'result') = '' or jsonb_typeof(v_definition->'label') <> 'string'
      or btrim(v_definition->>'label') = '' then return null; end if;
    v_id := p_test_id;
    v_label := v_definition->>'label';
    v_result := v_definition->>'result';
  else
    v_lines := string_to_array(coalesce(v_facts->'sections'->>'tests', ''), chr(10));
    foreach v_line in array v_lines loop
      v_line := btrim(v_line);
      if v_line = '' or v_line ~ '^(辅助检查|辅检|入院后辅检)[：:]$' then continue; end if;
      v_id := 'source-test-' || v_index;
      if v_id = p_test_id then
        v_norm := regexp_replace(v_line, '^[一二三四五六七八九十\d]+[、.．]\s*', '');
        v_label := null;
        foreach v_name in array v_whitelist loop
          if v_norm like v_name || '%' and (v_label is null or length(v_name) > length(v_label)) then
            v_label := v_name;
          end if;
        end loop;
        if v_label is null then v_label := '检查记录 ' || (v_index + 1); end if;
        v_result := v_line;
        exit;
      end if;
      v_index := v_index + 1;
    end loop;
  end if;
  if v_result is null or v_result = '' or v_id is distinct from p_test_id then return null; end if;

  select item into v_release from jsonb_array_elements(coalesce(v_config->'testRelease','[]'::jsonb)) item
    where item->>'testId' = p_test_id limit 1;
  if v_release->>'availableFromStage' is not null and (
      array_position(v_stages,v_release->>'availableFromStage') is null or
      array_position(v_stages,v_row.state->>'stage') is null or
      array_position(v_stages,v_row.state->>'stage') < array_position(v_stages,v_release->>'availableFromStage')) then
    return jsonb_build_object('id',v_id,'label',v_label,'result','','pending',true,
      'resultDelayNote',coalesce(v_release->>'resultDelayNote','标本已送检，结果待回报。'));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('fileId',media->>'fileId','kind','image','caption',media->>'caption')),'[]'::jsonb) into v_media
    from jsonb_array_elements(coalesce(v_config->'testMedia','[]'::jsonb)) binding,
         jsonb_array_elements(coalesce(binding->'media','[]'::jsonb)) media
    where binding->>'testId' = p_test_id and media->>'kind' = 'image'
      and jsonb_typeof(media->'fileId') = 'string' and media->>'fileId' <> ''
      and jsonb_typeof(media->'caption') = 'string';
  return jsonb_build_object('id',v_id,'label',v_label,'result',v_result)
    || case when jsonb_array_length(v_media)>0 then jsonb_build_object('media',v_media) else '{}'::jsonb end;
end;
$function$;

REVOKE ALL ON FUNCTION case_snapshot_list_tests(text,text,uuid) FROM public, anon;
REVOKE ALL ON FUNCTION case_snapshot_record_test_order(text,text,uuid,text) FROM public, anon;
REVOKE ALL ON FUNCTION case_snapshot_get_test(text,text,uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION case_snapshot_list_tests(text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION case_snapshot_record_test_order(text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION case_snapshot_get_test(text,text,uuid,text) TO authenticated;

COMMIT;
