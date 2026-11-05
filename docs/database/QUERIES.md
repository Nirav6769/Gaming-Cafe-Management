# GameHub DBMS Lab Queries

## Query 1: Vector Semantic Similarity Search (pgvector)
```sql
SELECT
  g.game_id,
  g.title,
  gc.category_name,
  g.description,
  (g.search_embedding <=> $1::vector) AS cosine_distance,
  (1 - (g.search_embedding <=> $1::vector)) AS similarity_score
FROM public.games g
LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
WHERE g.search_embedding IS NOT NULL
  AND g.is_active = TRUE
ORDER BY g.search_embedding <=> $1::vector ASC
LIMIT 5;
```

## Query 2: Popular Games Aggregation
```sql
SELECT
  g.game_id,
  g.title,
  COALESCE(gc.category_name, 'Uncategorized') AS category_name,
  g.is_active,
  COUNT(sg.session_id)::BIGINT AS total_plays,
  COALESCE(SUM(sg.duration_minutes), 0)::BIGINT AS total_recorded_minutes,
  ROUND(
    COALESCE(AVG(sg.duration_minutes), 0)::NUMERIC,
    1
  ) AS avg_duration_per_play
FROM public.games g
LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
LEFT JOIN public.session_games sg ON sg.game_id = g.game_id
GROUP BY g.game_id, g.title, gc.category_name, g.is_active
ORDER BY total_plays DESC, total_recorded_minutes DESC;
```

## Query 3: High-Engagement Genres (HAVING Clause)
```sql
SELECT
  gc.category_name,
  COUNT(DISTINCT g.game_id)::BIGINT AS active_titles_count,
  COUNT(sg.session_id)::BIGINT AS total_plays,
  COALESCE(SUM(sg.duration_minutes), 0)::BIGINT AS total_playtime_minutes
FROM public.game_categories gc
JOIN public.games g ON g.category_id = gc.category_id
LEFT JOIN public.session_games sg ON sg.game_id = g.game_id
GROUP BY gc.category_name
HAVING COUNT(sg.session_id) > 0
ORDER BY total_playtime_minutes DESC, total_plays DESC;
```

## Query 4: Above-Average Games (Nested Subquery)
```sql
SELECT
  g.game_id,
  g.title,
  gc.category_name,
  COUNT(sg.session_id) AS game_plays
FROM public.games g
LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
LEFT JOIN public.session_games sg ON sg.game_id = g.game_id
GROUP BY g.game_id, g.title, gc.category_name
HAVING COUNT(sg.session_id) > (
  SELECT AVG(play_counts.cnt)
  FROM (
    SELECT COUNT(session_id) AS cnt
    FROM public.games sub_g
    LEFT JOIN public.session_games sub_sg ON sub_sg.game_id = sub_g.game_id
    GROUP BY sub_g.game_id
  ) AS play_counts
)
ORDER BY game_plays DESC;
```

## Query 5: Top Spenders Subquery (Commerce Integration)
```sql
SELECT
  c.customer_id,
  c.name,
  c.email,
  SUM(p.amount)::NUMERIC(10,2) AS total_spent
FROM public.customers c
JOIN public.orders o ON o.customer_id = c.customer_id
JOIN public.payments p ON p.order_id = o.order_id
WHERE p.status = 'paid'
GROUP BY c.customer_id, c.name, c.email
HAVING SUM(p.amount) > (
  SELECT AVG(amount)
  FROM public.payments
  WHERE status = 'paid'
)
ORDER BY total_spent DESC;
```

## Query 6: Unified Multi-Stream Revenue View (UNION ALL)
```sql
CREATE OR REPLACE VIEW public.vw_daily_revenue AS
SELECT
  DATE(end_time) AS revenue_date,
  'session' AS source,
  total_cost AS amount,
  session_id::TEXT AS reference_id
FROM public.gaming_sessions
WHERE end_time IS NOT NULL AND total_cost > 0

UNION ALL

SELECT
  DATE(p.payment_date) AS revenue_date,
  'snack_order' AS source,
  p.amount AS amount,
  p.payment_id::TEXT AS reference_id
FROM public.payments p
WHERE p.status = 'paid'

UNION ALL

SELECT
  DATE(created_at) AS revenue_date,
  'membership' AS source,
  price_paid AS amount,
  membership_id::TEXT AS reference_id
FROM public.customer_memberships
WHERE status = 'active' AND price_paid > 0;
```

## Query 7: Pessimistic Row Locking Concurrency Trigger
```sql
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
```

## Query 8: Temporal Exclusion Constraint (No Double Booking)
```sql
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_pc_id_time_excl;

ALTER TABLE public.reservations ADD CONSTRAINT reservations_pc_id_time_excl
  EXCLUDE USING gist (
    pc_id WITH =,
    tsrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (status = 'confirmed');
```

## Query 9: Historical Rate Snapshot
```sql
ALTER TABLE public.gaming_sessions
  ADD COLUMN IF NOT EXISTS hourly_rate_snapshot NUMERIC(8,2);

UPDATE public.gaming_sessions gs
SET hourly_rate_snapshot = gp.hourly_rate
FROM public.gaming_pcs gp
WHERE gp.pc_id = gs.pc_id
  AND gs.hourly_rate_snapshot IS NULL;
```

## Query 10: Preserving History via Foreign Key Constraints
```sql
ALTER TABLE public.session_games
  DROP CONSTRAINT IF EXISTS session_games_game_id_fkey;

ALTER TABLE public.session_games
  ADD CONSTRAINT session_games_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.games(game_id)
  ON DELETE RESTRICT;

ALTER TABLE public.tournament_registrations
  DROP CONSTRAINT IF EXISTS tournament_registrations_tournament_id_fkey;

ALTER TABLE public.tournament_registrations
  ADD CONSTRAINT tournament_registrations_tournament_id_fkey
  FOREIGN KEY (tournament_id) REFERENCES public.tournaments(tournament_id)
  ON DELETE RESTRICT;
```
