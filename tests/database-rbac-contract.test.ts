import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync("database/migrations/005_database_rbac.sql", "utf8");
const databaseAdapter = readFileSync("src/lib/db.ts", "utf8");
const authAdapter = readFileSync("src/lib/auth.ts", "utf8");

const applicationTables = [
  "user_profiles", "customers", "staff", "gaming_pcs", "game_categories",
  "games", "tournaments", "maintenance_records", "gaming_sessions",
  "session_games", "tournament_registrations", "reservations",
  "membership_plans", "customer_memberships", "snack_items", "orders",
  "order_items", "payments",
];

test("database RBAC creates non-login, non-bypass application roles", () => {
  for (const role of ["gamehub_admin", "gamehub_staff", "gamehub_customer", "gamehub_runtime"]) {
    assert.match(migration, new RegExp("CREATE ROLE " + role + " NOLOGIN"));
    assert.match(migration, new RegExp(role + "[\\s\\S]*?NOBYPASSRLS"));
  }
});

test("every application table has row-level security enabled", () => {
  for (const table of applicationTables) {
    assert.ok(
      migration.includes("ALTER TABLE public." + table + " ENABLE ROW LEVEL SECURITY;"),
      "RLS must be enabled for " + table,
    );
  }
});

test("database policies include role and customer-ownership checks", () => {
  assert.match(migration, /CREATE POLICY gamehub_customers_select[\\s\\S]*current_customer_id/);
  assert.match(migration, /CREATE POLICY gamehub_sessions_select[\\s\\S]*current_customer_id/);
  assert.match(migration, /CREATE POLICY gamehub_orders_select[\\s\\S]*current_customer_id/);
  assert.match(migration, /CREATE POLICY gamehub_payments_select[\\s\\S]*current_customer_id/);
  assert.match(migration, /GRANT SELECT ON TABLE public.vw_daily_revenue TO gamehub_admin/);
});

test("application queries require verified identity and transaction-local database roles", () => {
  assert.match(databaseAdapter, /Refusing an application database query without a verified Supabase identity/);
  assert.match(databaseAdapter, /SET LOCAL ROLE/);
  assert.match(databaseAdapter, /set_config\('gamehub.user_id'/);
  assert.match(databaseAdapter, /AsyncLocalStorage/);
});

test("only a Supabase-verified and profile-authorized user establishes database identity", () => {
  assert.match(authAdapter, /supabase\.auth\.getUser\(\)/);
  assert.match(authAdapter, /decideProfileAccess\(identity, profile, allowedRoles\)/);
  assert.match(authAdapter, /setDatabaseIdentity\(/);
  assert.match(authAdapter, /systemQuery<ProfileRow>/);
});
