BEGIN;
DO $guard$
BEGIN
  IF current_schema() IS DISTINCT FROM 'tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema' THEN
    RAISE EXCEPTION 'CASE_SNAPSHOT_TARGET_TENANT_MISMATCH';
  END IF;
  IF to_regclass('"tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".case_snapshot_answers') IS NULL THEN
    RAISE EXCEPTION 'CASE_SNAPSHOT_ANSWERS_BASELINE_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class
      WHERE oid = '"tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".case_snapshot_answers'::regclass
      AND relrowsecurity) THEN
    RAISE EXCEPTION 'CASE_SNAPSHOT_ANSWERS_RLS_REQUIRED';
  END IF;
END;
$guard$;

-- Private teacher-only table: never append binding configuration to student facts.
-- No backfill: historical snapshots remain exactly bound, including missing config.
-- No roles, grants, RLS policies, RPCs or existing values are changed.
ALTER TABLE "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".case_snapshot_answers
  ADD COLUMN IF NOT EXISTS binding_config jsonb;
COMMENT ON COLUMN "tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema".case_snapshot_answers.binding_config
  IS 'Version-bound private testMedia/examMedia/testRelease. Null means not persisted, not empty. Do not expose through general facts RPC.';
COMMIT;
