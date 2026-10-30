-- Run this AFTER schema.sql in the Supabase SQL Editor.
-- Safe to run more than once.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_pc
ON gaming_sessions (pc_id)
WHERE end_time IS NULL;

CREATE INDEX IF NOT EXISTS gaming_sessions_start_time_idx
ON gaming_sessions (start_time DESC);

CREATE INDEX IF NOT EXISTS gaming_sessions_customer_idx
ON gaming_sessions (customer_id);

CREATE INDEX IF NOT EXISTS gaming_sessions_pc_idx
ON gaming_sessions (pc_id);
