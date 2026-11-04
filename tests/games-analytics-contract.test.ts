import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("games-analytics migration extends games table with embedding metadata and active flag", async () => {
  const sql = await readFile(resolve(process.cwd(), "database/migrations/004_games_analytics.sql"), "utf8");
  assert.match(sql, /embedding_model TEXT/);
  assert.match(sql, /embedding_updated_at TIMESTAMPTZ/);
  assert.match(sql, /is_active BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(sql, /games_category_active_idx/);
});

test("games-analytics migration creates HNSW cosine index for pgvector embeddings", async () => {
  const sql = await readFile(resolve(process.cwd(), "database/migrations/004_games_analytics.sql"), "utf8");
  assert.match(sql, /CREATE INDEX IF NOT EXISTS games_search_embedding_hnsw_idx/);
  assert.match(sql, /USING hnsw \(search_embedding vector_cosine_ops\)/);
  assert.match(sql, /WHERE search_embedding IS NOT NULL/);
});

test("games-analytics migration adds tournament status, constraints, and concurrency lock", async () => {
  const sql = await readFile(resolve(process.cwd(), "database/migrations/004_games_analytics.sql"), "utf8");
  assert.match(sql, /tournaments_status_check/);
  assert.match(sql, /tournaments_max_participants_check/);
  assert.match(sql, /tournaments_prize_pool_check/);
  assert.match(sql, /games_guard_tournament_registration/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /tournament_registrations_guard_capacity/);
});

test("games-analytics migration replaces cascade delete with restrict to preserve history", async () => {
  const sql = await readFile(resolve(process.cwd(), "database/migrations/004_games_analytics.sql"), "utf8");
  assert.match(sql, /session_games_session_id_fkey/);
  assert.match(sql, /session_games_game_id_fkey/);
  assert.match(sql, /tournament_registrations_tournament_id_fkey/);
  assert.match(sql, /tournament_registrations_customer_id_fkey/);
  assert.match(sql, /ON DELETE RESTRICT/);
});

test("games-analytics migration creates security-invoker views and revokes anon access", async () => {
  const sql = await readFile(resolve(process.cwd(), "database/migrations/004_games_analytics.sql"), "utf8");
  assert.match(sql, /vw_popular_games/);
  assert.match(sql, /vw_pc_usage_summary/);
  assert.match(sql, /vw_daily_revenue/);
  assert.match(sql, /WITH \(security_invoker = true\)/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE[\s\S]*vw_popular_games[\s\S]*FROM anon, authenticated/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.games_guard_tournament_registration\(\)\s+FROM anon, authenticated/);
});
