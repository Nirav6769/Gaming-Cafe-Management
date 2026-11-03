-- Operations module migration. Apply after 001_auth_foundation.sql.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.reservations (
  reservation_id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES public.customers(customer_id) ON DELETE RESTRICT,
  pc_id INTEGER NOT NULL REFERENCES public.gaming_pcs(pc_id) ON DELETE RESTRICT,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed')),
  notes TEXT,
  created_by_staff_id INTEGER REFERENCES public.staff(staff_id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_time > start_time)
);
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_pc_id_time_excl;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_pc_id_time_excl
  EXCLUDE USING gist (pc_id WITH =, tsrange(start_time,end_time,'[)') WITH &&)
  WHERE (status = 'confirmed');

ALTER TABLE public.gaming_sessions
  ADD COLUMN IF NOT EXISTS expected_end_time TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reservation_id INTEGER REFERENCES public.reservations(reservation_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hourly_rate_snapshot NUMERIC(8,2);

UPDATE public.gaming_sessions gs
SET hourly_rate_snapshot = gp.hourly_rate
FROM public.gaming_pcs gp
WHERE gp.pc_id = gs.pc_id AND gs.hourly_rate_snapshot IS NULL;

ALTER TABLE public.gaming_sessions
  ADD CONSTRAINT gaming_sessions_expected_end_after_start
  CHECK (expected_end_time IS NULL OR expected_end_time > start_time);

ALTER TABLE public.maintenance_records
  ADD COLUMN IF NOT EXISTS maintenance_id BIGSERIAL;
ALTER TABLE public.maintenance_records
  DROP CONSTRAINT IF EXISTS maintenance_records_pkey;
ALTER TABLE public.maintenance_records
  ADD CONSTRAINT maintenance_records_pkey PRIMARY KEY (maintenance_id);

-- Preserve the original weak-entity uniqueness from schema.sql even though
-- maintenance_id is now the row identifier used by the Operations API.
DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_records_pc_date_unique'
      AND conrelid = 'public.maintenance_records'::regclass
  ) THEN
    ALTER TABLE public.maintenance_records
      ADD CONSTRAINT maintenance_records_pc_date_unique UNIQUE (pc_id, maintenance_date);
  END IF;
END $;
ALTER TABLE public.maintenance_records
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
UPDATE public.maintenance_records SET resolved_at = CURRENT_TIMESTAMP WHERE resolved = TRUE AND resolved_at IS NULL;

ALTER TABLE public.session_games
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE public.session_games
SET duration_minutes = play_duration_minutes
WHERE duration_minutes IS NULL AND play_duration_minutes IS NOT NULL;
ALTER TABLE public.session_games
  ADD CONSTRAINT session_games_duration_nonnegative CHECK (duration_minutes IS NULL OR duration_minutes >= 0);

CREATE OR REPLACE FUNCTION public.operations_guard_reservation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.gaming_pcs WHERE pc_id = NEW.pc_id FOR UPDATE;
  IF NEW.status = 'confirmed' AND EXISTS (
    SELECT 1 FROM public.gaming_sessions s
    WHERE s.pc_id = NEW.pc_id
      AND s.start_time < NEW.end_time
      AND COALESCE(s.end_time, s.expected_end_time, 'infinity'::timestamp) > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Reservation overlaps an existing gaming session' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reservations_guard_conflict ON public.reservations;
DROP TRIGGER IF EXISTS reservations_guard_conflict_update ON public.reservations;
CREATE TRIGGER reservations_guard_conflict
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.operations_guard_reservation();
CREATE TRIGGER reservations_guard_conflict_update
BEFORE UPDATE OF pc_id,start_time,end_time,status ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.operations_guard_reservation();

CREATE OR REPLACE FUNCTION public.operations_guard_session_reservation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  finish_at TIMESTAMP;
BEGIN
  PERFORM 1 FROM public.gaming_pcs WHERE pc_id = NEW.pc_id FOR UPDATE;
  finish_at := COALESCE(NEW.end_time, NEW.expected_end_time, 'infinity'::timestamp);
  IF EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.pc_id = NEW.pc_id AND r.status = 'confirmed'
      AND r.start_time < finish_at
      AND r.end_time > NEW.start_time
      AND (NEW.reservation_id IS NULL OR r.reservation_id <> NEW.reservation_id)
  ) THEN
    RAISE EXCEPTION 'Gaming session overlaps a confirmed reservation' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sessions_guard_reservation ON public.gaming_sessions;
DROP TRIGGER IF EXISTS sessions_guard_reservation_update ON public.gaming_sessions;
CREATE TRIGGER sessions_guard_reservation
BEFORE INSERT ON public.gaming_sessions
FOR EACH ROW EXECUTE FUNCTION public.operations_guard_session_reservation();
CREATE TRIGGER sessions_guard_reservation_update
BEFORE UPDATE OF pc_id,start_time,expected_end_time,reservation_id ON public.gaming_sessions
FOR EACH ROW EXECUTE FUNCTION public.operations_guard_session_reservation();

CREATE OR REPLACE FUNCTION public.operations_set_session_billing()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rate NUMERIC(8,2);
BEGIN
  IF NEW.end_time IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.end_time IS NULL) THEN
    rate := COALESCE(NEW.hourly_rate_snapshot, (SELECT hourly_rate FROM public.gaming_pcs WHERE pc_id = NEW.pc_id));
    NEW.hourly_rate_snapshot := rate;
    NEW.total_cost := ROUND((rate * GREATEST(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600, 0))::numeric, 2);
  ELSIF NEW.hourly_rate_snapshot IS NULL THEN
    SELECT hourly_rate INTO NEW.hourly_rate_snapshot FROM public.gaming_pcs WHERE pc_id = NEW.pc_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sessions_calculate_billing ON public.gaming_sessions;
DROP TRIGGER IF EXISTS sessions_calculate_billing_update ON public.gaming_sessions;
CREATE TRIGGER sessions_calculate_billing
BEFORE INSERT ON public.gaming_sessions
FOR EACH ROW EXECUTE FUNCTION public.operations_set_session_billing();
CREATE TRIGGER sessions_calculate_billing_update
BEFORE UPDATE OF end_time ON public.gaming_sessions
FOR EACH ROW EXECUTE FUNCTION public.operations_set_session_billing();

CREATE OR REPLACE FUNCTION public.operations_stamp_maintenance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resolved = TRUE AND (TG_OP = 'INSERT' OR OLD.resolved = FALSE) THEN
    NEW.resolved_at := COALESCE(NEW.resolved_at, CURRENT_TIMESTAMP);
  ELSIF NEW.resolved = FALSE THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS maintenance_stamp_resolved ON public.maintenance_records;
CREATE TRIGGER maintenance_stamp_resolved
BEFORE INSERT OR UPDATE ON public.maintenance_records
FOR EACH ROW EXECUTE FUNCTION public.operations_stamp_maintenance();

CREATE OR REPLACE FUNCTION public.operations_sync_pc_status()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_pc INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN target_pc := OLD.pc_id; ELSE target_pc := NEW.pc_id; END IF;
  UPDATE public.gaming_pcs p
  SET status = CASE
    WHEN EXISTS (SELECT 1 FROM public.maintenance_records m WHERE m.pc_id=target_pc AND m.resolved=FALSE) THEN 'maintenance'
    WHEN EXISTS (SELECT 1 FROM public.gaming_sessions s WHERE s.pc_id=target_pc AND s.end_time IS NULL) THEN 'occupied'
    ELSE 'available'
  END
  WHERE p.pc_id=target_pc;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS maintenance_sync_pc_status ON public.maintenance_records;
CREATE TRIGGER maintenance_sync_pc_status
AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_records
FOR EACH ROW EXECUTE FUNCTION public.operations_sync_pc_status();
DROP TRIGGER IF EXISTS sessions_sync_pc_status ON public.gaming_sessions;
CREATE TRIGGER sessions_sync_pc_status
AFTER INSERT OR UPDATE OR DELETE ON public.gaming_sessions
FOR EACH ROW EXECUTE FUNCTION public.operations_sync_pc_status();

-- Preserve operational history: deleting a customer or PC must not erase sessions or maintenance records.
ALTER TABLE public.maintenance_records DROP CONSTRAINT IF EXISTS maintenance_records_pc_id_fkey;
ALTER TABLE public.maintenance_records ADD CONSTRAINT maintenance_records_pc_id_fkey
  FOREIGN KEY (pc_id) REFERENCES public.gaming_pcs(pc_id) ON DELETE RESTRICT;
ALTER TABLE public.gaming_sessions DROP CONSTRAINT IF EXISTS gaming_sessions_customer_id_fkey;
ALTER TABLE public.gaming_sessions ADD CONSTRAINT gaming_sessions_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE RESTRICT;
ALTER TABLE public.gaming_sessions DROP CONSTRAINT IF EXISTS gaming_sessions_pc_id_fkey;
ALTER TABLE public.gaming_sessions ADD CONSTRAINT gaming_sessions_pc_id_fkey
  FOREIGN KEY (pc_id) REFERENCES public.gaming_pcs(pc_id) ON DELETE RESTRICT;

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.reservations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.reservations_reservation_id_seq, public.maintenance_records_maintenance_id_seq FROM anon, authenticated;
