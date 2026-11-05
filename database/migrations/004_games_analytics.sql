-- Games, Tournaments, Semantic Search & Analytics module migration.
-- Migration version: 004
-- Module owner: Nikhil
-- Dependencies: 001_auth_foundation.sql, 002_commerce.sql, 003_operations.sql

-- ============================================================================
-- 1. Games table enhancements for embedding metadata and archival
-- ============================================================================

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS games_category_active_idx
  ON public.games(category_id, is_active);

-- HNSW cosine vector index for pgvector 384-dimensional embeddings
CREATE INDEX IF NOT EXISTS games_search_embedding_hnsw_idx
  ON public.games USING hnsw (search_embedding vector_cosine_ops)
  WHERE search_embedding IS NOT NULL;

-- ============================================================================
-- 2. Tournaments table enhancements and capacity management
-- ============================================================================

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS max_participants INTEGER,
  ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS description TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournaments_status_check'
      AND conrelid = 'public.tournaments'::regclass
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_status_check
      CHECK (status IN ('draft', 'open', 'closed', 'completed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournaments_max_participants_check'
      AND conrelid = 'public.tournaments'::regclass
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_max_participants_check
      CHECK (max_participants IS NULL OR max_participants > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournaments_prize_pool_check'
      AND conrelid = 'public.tournaments'::regclass
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_prize_pool_check
      CHECK (prize_pool IS NULL OR prize_pool >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tournaments_status_start_idx
  ON public.tournaments(status, start_date);

CREATE INDEX IF NOT EXISTS tournament_registrations_tournament_idx
  ON public.tournament_registrations(tournament_id);

CREATE INDEX IF NOT EXISTS tournament_registrations_customer_idx
  ON public.tournament_registrations(customer_id);

-- ============================================================================
-- 3. Concurrency-safe tournament registration trigger
-- Locks parent tournament row FOR UPDATE to prevent race-condition overbooking
-- ============================================================================

CREATE OR REPLACE FUNCTION public.games_guard_tournament_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
  v_max_participants INTEGER;
  v_deadline TIMESTAMPTZ;
  v_start_date DATE;
  v_current_count INTEGER;
BEGIN
  -- Row lock parent tournament to serialize concurrent registration attempts
  SELECT status, max_participants, registration_deadline, start_date
  INTO v_status, v_max_participants, v_deadline, v_start_date
  FROM public.tournaments
  WHERE tournament_id = NEW.tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament does not exist' USING ERRCODE = '23503';
  END IF;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'Tournament is not open for registration (status: %)', v_status USING ERRCODE = '23514';
  END IF;

  IF v_deadline IS NOT NULL AND CURRENT_TIMESTAMP > v_deadline THEN
    RAISE EXCEPTION 'Tournament registration deadline has passed' USING ERRCODE = '23514';
  END IF;

  IF v_deadline IS NULL AND v_start_date IS NOT NULL AND CURRENT_DATE > v_start_date THEN
    RAISE EXCEPTION 'Tournament has already started' USING ERRCODE = '23514';
  END IF;

  IF v_max_participants IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER
    INTO v_current_count
    FROM public.tournament_registrations
    WHERE tournament_id = NEW.tournament_id;

    IF v_current_count >= v_max_participants THEN
      RAISE EXCEPTION 'Tournament capacity reached (% participants max)', v_max_participants USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_registrations_guard_capacity ON public.tournament_registrations;
CREATE TRIGGER tournament_registrations_guard_capacity
BEFORE INSERT ON public.tournament_registrations
FOR EACH ROW EXECUTE FUNCTION public.games_guard_tournament_registration();

-- ============================================================================
-- 4. Preserve game & tournament history: Replace CASCADE with RESTRICT
-- ============================================================================

DO $$
BEGIN
  -- session_games: session_id FK
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_games_session_id_fkey'
      AND conrelid = 'public.session_games'::regclass
  ) THEN
    ALTER TABLE public.session_games DROP CONSTRAINT session_games_session_id_fkey;
    ALTER TABLE public.session_games
      ADD CONSTRAINT session_games_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.gaming_sessions(session_id) ON DELETE RESTRICT;
  END IF;

  -- session_games: game_id FK
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_games_game_id_fkey'
      AND conrelid = 'public.session_games'::regclass
  ) THEN
    ALTER TABLE public.session_games DROP CONSTRAINT session_games_game_id_fkey;
    ALTER TABLE public.session_games
      ADD CONSTRAINT session_games_game_id_fkey
      FOREIGN KEY (game_id) REFERENCES public.games(game_id) ON DELETE RESTRICT;
  END IF;

  -- tournament_registrations: tournament_id FK
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournament_registrations_tournament_id_fkey'
      AND conrelid = 'public.tournament_registrations'::regclass
  ) THEN
    ALTER TABLE public.tournament_registrations DROP CONSTRAINT tournament_registrations_tournament_id_fkey;
    ALTER TABLE public.tournament_registrations
      ADD CONSTRAINT tournament_registrations_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES public.tournaments(tournament_id) ON DELETE RESTRICT;
  END IF;

  -- tournament_registrations: customer_id FK
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournament_registrations_customer_id_fkey'
      AND conrelid = 'public.tournament_registrations'::regclass
  ) THEN
    ALTER TABLE public.tournament_registrations DROP CONSTRAINT tournament_registrations_customer_id_fkey;
    ALTER TABLE public.tournament_registrations
      ADD CONSTRAINT tournament_registrations_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ============================================================================
-- 5. Analytics Views
-- Created WITH (security_invoker = true) and revoked from anon/authenticated
-- ============================================================================

-- View 1: Popular Games (Play counts and recorded minutes from session_games)
DROP VIEW IF EXISTS public.vw_popular_games;
CREATE VIEW public.vw_popular_games
WITH (security_invoker = true) AS
SELECT
  g.game_id,
  g.title,
  gc.category_name,
  g.is_active,
  COUNT(sg.session_id)::BIGINT AS play_count,
  COALESCE(SUM(sg.duration_minutes), 0)::BIGINT AS total_recorded_minutes
FROM public.games g
LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
LEFT JOIN public.session_games sg ON sg.game_id = g.game_id
GROUP BY g.game_id, g.title, gc.category_name, g.is_active;

-- View 2: PC Usage Summary (Observed minutes and revenue from completed sessions)
DROP VIEW IF EXISTS public.vw_pc_usage_summary;
CREATE VIEW public.vw_pc_usage_summary
WITH (security_invoker = true) AS
SELECT
  p.pc_id,
  p.pc_name,
  p.status,
  p.hourly_rate,
  COUNT(s.session_id) FILTER (WHERE s.end_time IS NOT NULL)::BIGINT AS completed_sessions_count,
  COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60)::NUMERIC, 2), 0) AS total_used_minutes,
  COALESCE(ROUND(SUM(s.total_cost)::NUMERIC, 2), 0) AS total_session_revenue
FROM public.gaming_pcs p
LEFT JOIN public.gaming_sessions s ON s.pc_id = p.pc_id AND s.end_time IS NOT NULL
GROUP BY p.pc_id, p.pc_name, p.status, p.hourly_rate;

-- View 3: Daily Revenue (UNION ALL of sessions, snack orders, and memberships)
DROP VIEW IF EXISTS public.vw_daily_revenue;
CREATE VIEW public.vw_daily_revenue
WITH (security_invoker = true) AS
SELECT
  (s.end_time AT TIME ZONE 'UTC')::DATE AS revenue_date,
  'session'::TEXT AS source,
  s.total_cost::NUMERIC(10,2) AS amount,
  s.session_id::TEXT AS reference_id
FROM public.gaming_sessions s
WHERE s.end_time IS NOT NULL
  AND s.total_cost IS NOT NULL
  AND s.total_cost > 0

UNION ALL

SELECT
  (p.created_at AT TIME ZONE 'UTC')::DATE AS revenue_date,
  'snack_order'::TEXT AS source,
  p.amount::NUMERIC(10,2) AS amount,
  p.payment_id::TEXT AS reference_id
FROM public.payments p
WHERE p.status = 'paid'
  AND p.amount > 0

UNION ALL

SELECT
  (cm.created_at AT TIME ZONE 'UTC')::DATE AS revenue_date,
  'membership'::TEXT AS source,
  cm.price_paid::NUMERIC(10,2) AS amount,
  cm.membership_id::TEXT AS reference_id
FROM public.customer_memberships cm
WHERE cm.status <> 'cancelled'
  AND cm.price_paid > 0;

-- ============================================================================
-- 6. Security Footer
-- Revoke all permissions on new views/functions from anon and authenticated roles
-- ============================================================================

REVOKE ALL PRIVILEGES ON TABLE
  public.vw_popular_games,
  public.vw_pc_usage_summary,
  public.vw_daily_revenue
FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.games_guard_tournament_registration()
FROM anon, authenticated;
