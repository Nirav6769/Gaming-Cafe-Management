import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { databaseTestSkip, withRollback } from "./helpers/db";

const appTables = [
  "user_profiles",
  "customers",
  "staff",
  "gaming_pcs",
  "game_categories",
  "games",
  "tournaments",
  "maintenance_records",
  "gaming_sessions",
  "session_games",
  "tournament_registrations",
];

const fixtureSql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'CREATE ROLE anon NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated NOLOGIN';
  END IF;
END
$$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  email TEXT
);

CREATE TABLE public.customers (
  customer_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE public.staff (
  staff_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE public.gaming_pcs (
  pc_id SERIAL PRIMARY KEY,
  pc_name TEXT NOT NULL
);
CREATE TABLE public.game_categories (
  category_id SERIAL PRIMARY KEY,
  category_name TEXT NOT NULL
);
CREATE TABLE public.games (
  game_id SERIAL PRIMARY KEY,
  title TEXT NOT NULL
);
CREATE TABLE public.tournaments (
  tournament_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  game_id INTEGER
);
CREATE TABLE public.maintenance_records (
  pc_id INTEGER,
  maintenance_date DATE,
  issue_description TEXT
);
CREATE TABLE public.gaming_sessions (
  session_id SERIAL PRIMARY KEY,
  customer_id INTEGER,
  pc_id INTEGER
);
CREATE TABLE public.session_games (
  session_id INTEGER,
  game_id INTEGER
);
CREATE TABLE public.tournament_registrations (
  tournament_id INTEGER,
  customer_id INTEGER
);
CREATE TABLE public.unrelated_public_table (id INTEGER PRIMARY KEY);
CREATE FUNCTION public.preserved_test_function() RETURNS INTEGER
LANGUAGE SQL IMMUTABLE AS 'SELECT 1';

GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserved_test_function() TO anon, authenticated;
`;

test(
  "auth migration scopes RLS and revokes only app table and sequence grants",
  { skip: databaseTestSkip },
  async () => {
    const migration = await readFile(
      resolve(process.cwd(), "database/migrations/001_auth_foundation.sql"),
      "utf8",
    );

    await withRollback(async (client) => {
      await client.query(fixtureSql);
      await client.query(migration);

      const rls = await client.query(
        `SELECT c.relname, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      );
      const rlsByName = new Map(
        rls.rows.map((row) => [row.relname as string, row.relrowsecurity as boolean]),
      );

      for (const tableName of appTables) {
        assert.equal(rlsByName.get(tableName), true, `${tableName} should have RLS enabled`);
        const access = await client.query(
          "SELECT has_table_privilege('anon', $1, 'SELECT') AS anon_select, has_table_privilege('authenticated', $1, 'SELECT') AS auth_select",
          [`public.${tableName}`],
        );
        assert.equal(access.rows[0].anon_select, false, `${tableName} should not be directly selectable by anon`);
        assert.equal(access.rows[0].auth_select, false, `${tableName} should not be directly selectable by authenticated`);
      }

      assert.equal(rlsByName.get("unrelated_public_table"), false);
      const unrelated = await client.query(
        "SELECT has_table_privilege('anon', 'public.unrelated_public_table', 'SELECT') AS can_select",
      );
      assert.equal(unrelated.rows[0].can_select, true);

      const functionAccess = await client.query(
        "SELECT has_function_privilege('anon', 'public.preserved_test_function()', 'EXECUTE') AS can_execute",
      );
      assert.equal(functionAccess.rows[0].can_execute, true);

      const authSchema = await client.query(
        "SELECT has_schema_privilege('anon', 'auth', 'USAGE') AS can_use_auth_schema",
      );
      assert.equal(authSchema.rows[0].can_use_auth_schema, true);

      const sequenceAccess = await client.query(
        "SELECT has_sequence_privilege('anon', 'public.customers_customer_id_seq', 'USAGE') AS can_use_sequence",
      );
      assert.equal(sequenceAccess.rows[0].can_use_sequence, false);
    });
  },
);
