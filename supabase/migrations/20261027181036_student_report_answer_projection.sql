BEGIN;
DO $guard$
BEGIN
  IF current_schema() IS DISTINCT FROM 'tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema' THEN
    RAISE EXCEPTION 'REPORT_TARGET_TENANT_MISMATCH';
  END IF;
  IF to_regprocedure('"tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".report_get_mine(uuid)') IS NULL
    OR to_regprocedure('"tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".report_list_mine()') IS NULL THEN
    RAISE EXCEPTION 'REPORT_RPC_BASELINE_MISSING';
  END IF;
END;
$guard$;

-- Read-time projection only: stored historical scores/submissions and teacher reads stay intact.
CREATE OR REPLACE FUNCTION "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".report_student_projection(p_data jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
  SELECT CASE WHEN jsonb_typeof(p_data->'evidence') = 'array' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_data->'evidence') e
    WHERE e->>'code' IN ('SOURCE_DIAGNOSIS_REFERENCE','SOURCE_PLAN_REFERENCE')
  ) THEN jsonb_set(jsonb_set(p_data,'{evidence}',(
    SELECT coalesce(jsonb_agg(e ORDER BY n),'[]'::jsonb)
    FROM jsonb_array_elements(p_data->'evidence') WITH ORDINALITY AS items(e,n)
    WHERE e->>'code' IS NULL OR e->>'code' NOT IN ('SOURCE_DIAGNOSIS_REFERENCE','SOURCE_PLAN_REFERENCE')
  )),'{recommendation}',to_jsonb('根据本轮实际获得的问诊、查体和检查证据，复盘自己的诊断依据、鉴别与处置；完整标准病历由教师保留。'::text))
  ELSE p_data END;
$$;
REVOKE ALL ON FUNCTION "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".report_student_projection(jsonb) FROM PUBLIC,anon,authenticated;

-- Existing RPC ownership checks retained; CREATE OR REPLACE preserves their ACLs.
CREATE OR REPLACE FUNCTION "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".report_get_mine(p_report_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_row record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT id,session_id,user_id,case_id,mode,total_score,status,data,created_at
  INTO v_row FROM "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".training_reports WHERE id=p_report_id;
  IF v_row IS NULL OR v_row.user_id IS DISTINCT FROM auth.uid() THEN RETURN NULL; END IF;
  RETURN jsonb_set(to_jsonb(v_row),'{data}',"tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".report_student_projection(v_row.data));
END;
$$;

CREATE OR REPLACE FUNCTION "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".report_list_mine()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(t.*),'[]'::jsonb) INTO v_rows FROM (
    SELECT id,session_id,user_id,case_id,mode,total_score,status,
      "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".report_student_projection(data) AS data,created_at
    FROM "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".training_reports
    WHERE user_id=auth.uid() ORDER BY created_at DESC
  ) t;
  RETURN v_rows;
END;
$$;
COMMIT;
