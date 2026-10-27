BEGIN;
DO $guard$
BEGIN
  IF current_schema() IS DISTINCT FROM 'tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema' THEN
    RAISE EXCEPTION 'CASE_SNAPSHOT_TARGET_TENANT_MISMATCH';
  END IF;
  IF to_regprocedure('"tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".case_snapshot_get_facts(text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'CASE_SNAPSHOT_RPC_BASELINE_MISSING';
  END IF;
  BEGIN
    PERFORM binding_config FROM "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".case_snapshot_answers LIMIT 0;
  EXCEPTION WHEN undefined_column THEN
    RAISE EXCEPTION 'CASE_SNAPSHOT_PRIVATE_CONFIG_MIGRATION_REQUIRED';
  END;
END;
$guard$;
-- Replace only the existing facts RPC; ACL, owner/entry/version and source guards stay intact.
CREATE OR REPLACE FUNCTION case_snapshot_get_facts(p_case_id text, p_version text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_row record;
  v_facts jsonb;
  v_config jsonb;
  v_exam_media jsonb;
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
  select f.facts,a.binding_config into v_facts,v_config from case_snapshot_facts f
    left join case_snapshot_answers a on a.case_id=f.case_id and a.version=f.version
    where f.case_id = CASE p_case_id
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
    END and f.version = p_version;
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

  -- Never expose unperformed bindings, even if a legacy facts row contains metadata.
  v_facts := v_facts - 'examMedia' - 'testMedia' - 'testRelease' - 'binding_config';
  select coalesce(jsonb_agg(jsonb_build_object('examId',binding->>'examId','media',
    (select coalesce(jsonb_agg(jsonb_build_object('fileId',m->>'fileId','kind','image','caption',m->>'caption')),'[]'::jsonb)
     from jsonb_array_elements(coalesce(binding->'media','[]'::jsonb)) m
     where m->>'kind'='image' and jsonb_typeof(m->'fileId')='string' and m->>'fileId'<>'' and jsonb_typeof(m->'caption')='string'))),'[]'::jsonb)
    into v_exam_media
    from jsonb_array_elements(coalesce(v_config->'examMedia','[]'::jsonb)) binding
    where exists (
      select 1 from jsonb_array_elements(coalesce(v_state->'events','[]'::jsonb)) ev,
        jsonb_array_elements_text(coalesce(ev->'evidenceCodes','[]'::jsonb)) e(code)
      where ev->>'type'='EXAM_ACTION' and ev->>'stage'='exam' and ev->>'correct'='true'
        and left(e.code,10)='SOURCE_EX_' and v_evidence ? e.code
        and binding->>'examId'='source-exam-' || replace(substring(e.code from 11),'_','-')
    );
  if jsonb_array_length(v_exam_media)>0 then
    v_facts := v_facts || jsonb_build_object('examMedia',v_exam_media);
  end if;
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

COMMIT;
