-- ============================================================================
-- GameHub: Important SQL Queries Catalogue for PESU Rubric Demonstrations
-- Module: Games, Tournaments, Semantic Search & Analytics
-- Author: Nikhil
-- ============================================================================

-- ============================================================================
-- Query 1: Multi-Table JOIN with Aggregates and COALESCE
-- Purpose: Ranks games by play count and total observed playtime.
-- ============================================================================
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

-- ============================================================================
-- Query 2: GROUP BY with HAVING Clause and Aggregates
-- Purpose: Identifies high-engagement game genres with at least 1 recorded play.
-- ============================================================================
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

-- ============================================================================
-- Query 3: Subquery Comparison
-- Purpose: Finds games whose play count is strictly above the average play count across all games.
-- ============================================================================
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

-- ============================================================================
-- Query 4: Customer Spending Subquery with Commerce Integration
-- Purpose: Identifies VIP customers who spent more than the average customer payment.
-- ============================================================================
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

-- ============================================================================
-- Query 5: pgvector Vector Cosine Distance Retrieval (<=>)
-- Purpose: Retrieves top 5 closest games to a prompt embedding vector.
-- ============================================================================
SELECT
  g.game_id,
  g.title,
  gc.category_name,
  g.description,
  ROUND((g.search_embedding <=> $1::vector)::numeric, 4) AS cosine_distance,
  ROUND((1 - (g.search_embedding <=> $1::vector))::numeric, 4) AS similarity_score
FROM public.games g
LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
WHERE g.search_embedding IS NOT NULL
  AND g.is_active = TRUE
ORDER BY g.search_embedding <=> $1::vector ASC
LIMIT 5;

-- ============================================================================
-- Query 6: Unified Revenue View Query with Date Filtering
-- Purpose: Demonstrates aggregation across the 3 independent revenue streams.
-- ============================================================================
SELECT
  revenue_date,
  source,
  COUNT(*)::BIGINT AS transactions_count,
  SUM(amount)::NUMERIC(10,2) AS source_revenue
FROM public.vw_daily_revenue
WHERE revenue_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY revenue_date, source
ORDER BY revenue_date DESC, source ASC;
