-- Platform-managed tenant context; run only in the selected project database.
-- Additive supplement; does not mark older six migrations as applied.
-- Replayed after the original binding migration this is an idempotent no-op.
ALTER TABLE case_snapshot_answers ADD COLUMN IF NOT EXISTS binding_config jsonb;
