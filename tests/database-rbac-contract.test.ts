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
    assert.ok(migration.includes("CREATE ROLE " + role + " NOLOGIN"));
    assert.ok(migration.includes("NOBYPASSRLS"));
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
  for (const policy of [
    "gamehub_customers_select",
    "gamehub_sessions_select",
    "gamehub_orders_select",
    "gamehub_payments_select",
    "gamehub_tournament_registrations_select",
  ]) {
    assert.ok(migration.includes("CREATE POLICY " + policy));
  }
  assert.ok(migration.includes("app_private.current_customer_id()"));
  assert.ok(migration.includes("GRANT SELECT ON TABLE public.vw_daily_revenue TO gamehub_admin"));
  assert.ok(migration.includes("app_private.tournament_registration_count"));
});

test("application queries require verified identity and transaction-local database roles", () => {
  assert.ok(databaseAdapter.includes("Refusing an application database query without a verified Supabase identity"));
  assert.ok(databaseAdapter.includes("SET LOCAL ROLE"));
  assert.ok(databaseAdapter.includes("gamehub.user_id"));
  assert.ok(databaseAdapter.includes("AsyncLocalStorage"));
});

test("only a Supabase-verified and profile-authorized user establishes database identity", () => {
  assert.ok(authAdapter.includes("supabase.auth.getUser()"));
  assert.ok(authAdapter.includes("decideProfileAccess(identity, profile, allowedRoles)"));
  assert.ok(authAdapter.includes("setDatabaseIdentity("));
  assert.ok(authAdapter.includes("systemQuery<ProfileRow>"));
});
