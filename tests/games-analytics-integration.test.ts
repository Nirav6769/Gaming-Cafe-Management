import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { databaseTestSkip, withRollback } from "./helpers/db";
import { formatPgVector } from "../src/lib/embeddings/game-embeddings";

async function expectDbFailure(
  client: PoolClient,
  sql: string,
  values: unknown[],
  pattern: RegExp
) {
  await client.query("SAVEPOINT expected_failure");
  await assert.rejects(client.query(sql, values), pattern);
  await client.query("ROLLBACK TO SAVEPOINT expected_failure");
  await client.query("RELEASE SAVEPOINT expected_failure");
}

test(
  "games-analytics migration enforces tournament capacity, deadlines, history restrictions, and analytics views",
  { skip: databaseTestSkip },
  async () => {
    const schemaSql = await readFile(resolve(process.cwd(), "database/schema.sql"), "utf8");
    const mvpSql = await readFile(resolve(process.cwd(), "database/mvp_migration.sql"), "utf8");
    const migration001 = await readFile(resolve(process.cwd(), "database/migrations/001_auth_foundation.sql"), "utf8");
    const migration002 = await readFile(resolve(process.cwd(), "database/migrations/002_commerce.sql"), "utf8");
    const migration003 = await readFile(resolve(process.cwd(), "database/migrations/003_operations.sql"), "utf8");
    const migration004 = await readFile(resolve(process.cwd(), "database/migrations/004_games_analytics.sql"), "utf8");

    await withRollback(async (client) => {
      // 1. Self-contained auth fixture and roles
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE 'CREATE ROLE anon NOLOGIN';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE 'CREATE ROLE authenticated NOLOGIN';
          END IF;
        END $$;

        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (
          id UUID PRIMARY KEY,
          email TEXT
        );
      `);

      // 2. Provision baseline schema if not already present
      const hasCustomers = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers';"
      );
      if (hasCustomers.rows.length === 0) {
        await client.query(schemaSql);
        await client.query(mvpSql);
      }

      // 3. Provision Migration 001 (Auth Foundation) if not already present
      const hasProfiles = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles';"
      );
      if (hasProfiles.rows.length === 0) {
        await client.query(migration001);
      }

      // 4. Provision Migration 002 (Commerce) if not already present
      const hasCommerce = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customer_memberships';"
      );
      if (hasCommerce.rows.length === 0) {
        await client.query(migration002);
      }

      // 5. Provision Migration 003 (Operations) if not already present
      const hasOperations = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reservations';"
      );
      if (hasOperations.rows.length === 0) {
        await client.query(migration003);
      }

      // 6. Apply Migration 004 (Games & Analytics) if views not yet defined
      const hasMigration004 = await client.query(
        "SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'vw_popular_games';"
      );
      if (hasMigration004.rows.length === 0) {
        await client.query(migration004);
      }

      const pfx = `t${Date.now()}`;

      // Create test customers
      const c1 = await client.query("INSERT INTO customers (name, email) VALUES ('Player One', $1) RETURNING customer_id;", [`${pfx}_p1@test.com`]);
      const c2 = await client.query("INSERT INTO customers (name, email) VALUES ('Player Two', $2) RETURNING customer_id;", [`${pfx}_p2@test.com`]);
      const c3 = await client.query("INSERT INTO customers (name, email) VALUES ('Player Three', $3) RETURNING customer_id;", [`${pfx}_p3@test.com`]);
      const cust1 = c1.rows[0].customer_id as number;
      const cust2 = c2.rows[0].customer_id as number;
      const cust3 = c3.rows[0].customer_id as number;

      // Create category and game with 384d embedding
      const cat = await client.query("INSERT INTO game_categories (category_name) VALUES ($1) RETURNING category_id;", [`${pfx}-Category`]);
      const catId = cat.rows[0].category_id as number;

      const dummyVec = formatPgVector(new Array(384).fill(0.05));
      const game = await client.query(
        `INSERT INTO games (title, category_id, description, search_embedding, embedding_model, embedding_updated_at, is_active)
         VALUES ('Test Competitive Game', $1, 'A test game description', $2::vector, 'Xenova/all-MiniLM-L6-v2', CURRENT_TIMESTAMP, TRUE)
         RETURNING game_id;`,
        [catId, dummyVec]
      );
      const gameId = game.rows[0].game_id as number;

      // 1. Tournament capacity trigger test (max_participants = 2)
      const tourn = await client.query(
        `INSERT INTO tournaments (name, game_id, prize_pool, start_date, status, max_participants, registration_deadline)
         VALUES ('Test Championship', $1, 10000, CURRENT_DATE + 5, 'open', 2, CURRENT_TIMESTAMP + INTERVAL '2 days')
         RETURNING tournament_id;`,
        [gameId]
      );
      const tournId = tourn.rows[0].tournament_id as number;

      // Register first 2 participants successfully
      await client.query("INSERT INTO tournament_registrations (tournament_id, customer_id) VALUES ($1, $2);", [tournId, cust1]);
      await client.query("INSERT INTO tournament_registrations (tournament_id, customer_id) VALUES ($1, $2);", [tournId, cust2]);

      // Duplicate registration rejected by PK
      await expectDbFailure(
        client,
        "INSERT INTO tournament_registrations (tournament_id, customer_id) VALUES ($1, $2);",
        [tournId, cust1],
        /duplicate key|unique constraint/i
      );

      // 3rd registration rejected by capacity trigger
      await expectDbFailure(
        client,
        "INSERT INTO tournament_registrations (tournament_id, customer_id) VALUES ($1, $2);",
        [tournId, cust3],
        /Tournament capacity reached/i
      );

      // 2. Deadline check trigger test
      const expiredTourn = await client.query(
        `INSERT INTO tournaments (name, game_id, prize_pool, start_date, status, max_participants, registration_deadline)
         VALUES ('Past Tournament', $1, 5000, CURRENT_DATE - 2, 'open', 10, CURRENT_TIMESTAMP - INTERVAL '1 day')
         RETURNING tournament_id;`,
        [gameId]
      );
      const expiredId = expiredTourn.rows[0].tournament_id as number;

      await expectDbFailure(
        client,
        "INSERT INTO tournament_registrations (tournament_id, customer_id) VALUES ($1, $2);",
        [expiredId, cust1],
        /registration deadline has passed/i
      );

      // 3. Start date check trigger test (when registration_deadline IS NULL)
      const startedTourn = await client.query(
        `INSERT INTO tournaments (name, game_id, prize_pool, start_date, status, max_participants, registration_deadline)
         VALUES ('Started Tournament', $1, 5000, CURRENT_DATE - 1, 'open', 10, NULL)
         RETURNING tournament_id;`,
        [gameId]
      );
      const startedId = startedTourn.rows[0].tournament_id as number;

      await expectDbFailure(
        client,
        "INSERT INTO tournament_registrations (tournament_id, customer_id) VALUES ($1, $2);",
        [startedId, cust1],
        /Tournament has already started/i
      );

      // 4. Preserve history: ON DELETE RESTRICT on tournament_registrations
      await expectDbFailure(
        client,
        "DELETE FROM tournaments WHERE tournament_id = $1;",
        [tournId],
        /violates foreign key constraint.*RESTRICT/i
      );

      // 5. View vw_popular_games test
      const pc = await client.query("INSERT INTO gaming_pcs (pc_name, hourly_rate, status) VALUES ($1, 100, 'available') RETURNING pc_id;", [`${pfx}-PC`]);
      const pcId = pc.rows[0].pc_id as number;

      const session = await client.query(
        `INSERT INTO gaming_sessions (customer_id, pc_id, start_time, end_time, total_cost, hourly_rate_snapshot)
         VALUES ($1, $2, CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP, 100.00, 100.00)
         RETURNING session_id;`,
        [cust1, pcId]
      );
      const sessId = session.rows[0].session_id as number;

      await client.query(
        "INSERT INTO session_games (session_id, game_id, duration_minutes) VALUES ($1, $2, 45);",
        [sessId, gameId]
      );

      const popResult = await client.query("SELECT * FROM vw_popular_games WHERE game_id = $1;", [gameId]);
      assert.equal(popResult.rows.length, 1);
      assert.equal(Number(popResult.rows[0].play_count), 1);
      assert.equal(Number(popResult.rows[0].total_recorded_minutes), 45);

      // 6. View vw_pc_usage_summary test
      const usageResult = await client.query("SELECT * FROM vw_pc_usage_summary WHERE pc_id = $1;", [pcId]);
      assert.equal(usageResult.rows.length, 1);
      assert.equal(Number(usageResult.rows[0].completed_sessions_count), 1);
      assert.ok(Number(usageResult.rows[0].total_session_revenue) > 0);

      // 7. View vw_daily_revenue test (unions sessions, payments, memberships)
      const revResult = await client.query("SELECT * FROM vw_daily_revenue WHERE reference_id = $1 AND source = 'session';", [String(sessId)]);
      assert.equal(revResult.rows.length, 1);
      assert.equal(Number(revResult.rows[0].amount), 100.00);

      // 8. Vector distance query test
      const vectorSearch = await client.query(
        `SELECT game_id, title, search_embedding <=> $1::vector AS dist
         FROM games
         WHERE search_embedding IS NOT NULL
         ORDER BY search_embedding <=> $1::vector ASC
         LIMIT 1;`,
        [dummyVec]
      );
      assert.equal(vectorSearch.rows.length, 1);
      assert.ok(Number(vectorSearch.rows[0].dist) < 0.001); // Identical dummy vector has distance ≈ 0
    });
  }
);
