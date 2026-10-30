-- Run in the official project-selected tenant context.
-- Nullable means an untouched entry retains its existing selection policy during rollout.
ALTER TABLE case_publication ADD COLUMN IF NOT EXISTS active_version text;
