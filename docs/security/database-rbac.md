# Database-enforced authentication and RBAC

## Purpose

Supabase Auth remains the credential/session provider. public.user_profiles maps each verified Supabase Auth UUID to exactly one application role and its staff/customer record. This migration adds PostgreSQL role isolation and row-level security (RLS), so role and ownership rules are enforced by the database in addition to the existing Next.js API guards.

## Request flow

1. The browser signs in through Supabase Auth.
2. Each protected API handler calls requireApiRole() (or a protected page calls requirePageRole()).
3. The server verifies the cookie-backed session with supabase.auth.getUser().
4. The server resolves the corresponding row in public.user_profiles using a server-only profile lookup.
5. After role validation, the server stores the verified UUID and role in request-local AsyncLocalStorage.
6. Each application query runs inside a transaction. The adapter issues SET LOCAL ROLE gamehub_admin, gamehub_staff, or gamehub_customer and sets transaction-local gamehub.user_id.
7. PostgreSQL helper functions resolve the current role/customer/staff mapping from user_profiles, and RLS policies enforce table visibility, ownership, and permitted writes.
8. Commit or rollback clears the role and identity settings before the pooled connection is reused.

No user ID, role, staff ID, or customer ID is accepted from browser-supplied identity fields to establish database context.

## Database roles

- gamehub_admin: administrative access, including the daily revenue view.
- gamehub_staff: operational and commerce management access, without the Admin-only daily revenue view.
- gamehub_customer: public catalogue data and only the customer's own profile, sessions, registrations, reservations, memberships, orders, order items, and payment records.
- gamehub_runtime: shared non-login, non-superuser, non-BYPASSRLS table privileges inherited by the three application roles.

The roles cannot log in directly or bypass RLS. The existing postgres project connection is used only by trusted server code to switch locally into one of the non-login roles. Profile resolution uses the dedicated systemQuery() helper; normal application query() calls fail closed when a verified identity has not been established.

## Applying the migration

Apply database/migrations/005_database_rbac.sql once to the existing Supabase database, after migrations 001 through 004. Run it in the Supabase SQL Editor as the project database owner (postgres). Do not recreate the project, rerun baseline schema/seed scripts, or reset application data.

The migration is designed to be re-runnable: it creates roles only when missing, recreates named policies, replaces helper functions, and grants privileges idempotently. It assumes the integrated schema and views from migrations 001 through 004 exist.

After applying it, restart the Next.js development server so the new server-side database adapter is loaded.

## Verification

Run this read-only check in the Supabase SQL Editor:

    SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname IN (
      'gamehub_runtime',
      'gamehub_admin',
      'gamehub_staff',
      'gamehub_customer'
    )
    ORDER BY rolname;

    SELECT schemaname, tablename, policyname, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'gamehub_%'
    ORDER BY tablename, policyname;

All four roles should have rolcanlogin = false, rolsuper = false, and rolbypassrls = false. The policies should appear for the application tables listed in the migration.

The automated contract test is tests/database-rbac-contract.test.ts. CI should also run the repository's lint, unit/contract tests, and production build.

## Important operational notes

- Keep .env.local private. The server-side database password is never exposed through a NEXT_PUBLIC_ variable.
- Do not put a Supabase service-role key in the browser.
- Do not call systemQuery() from API handlers; it exists only for the verified Supabase Auth-to-profile lookup.
- Do not add API routes that access the database before calling the appropriate authentication/role guard.
- Any future table must have RLS enabled, explicit policies, and the appropriate grants before the app uses it.
- The tournament-capacity trigger is security-definer so it can count every registration despite customer RLS. It accepts no arguments and remains a trigger-only function; the registration table itself is still protected by RLS.
