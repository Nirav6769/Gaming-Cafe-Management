# Authentication setup

## Environment

Copy `.env.example` to `.env.local` and fill in the Supabase project URL,
publishable key, and server-side PostgreSQL connection string. Never commit
`.env.local`, a database password, or a Supabase secret/service-role key.

Use the Supabase session pooler connection string for `DATABASE_URL`. It is
used only by the Next.js server through `src/lib/db.ts`; do not prefix it with
`NEXT_PUBLIC_`. The expected pooler login is the project's PostgreSQL
`postgres` role (the pooler username is commonly `postgres.<project-ref>`).
Keep this credential server-only and rotate it if it has ever been shared.

The server PostgreSQL pool is intended to use the privileged project database
role. Verify the actual role after connecting:

```sql
SELECT current_user, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
```

For this design, `rolbypassrls` is expected to be true. If the role does not
bypass RLS, do not disable RLS to make queries work; review the server role and
authorization policy before proceeding.

For local and CI database tests, configure a separate disposable
`TEST_DATABASE_URL`. Never point test code at production data.

## Supabase Auth

1. In Supabase Dashboard, open Authentication and enable Email/Password.
2. Create the first administrator in Authentication > Users.
3. Run `database/migrations/001_auth_foundation.sql` after the existing schema,
   seed, and MVP migration files.
4. Link that Auth user to the seeded `Cafe Admin` staff row by running the
   administrator INSERT shown at the bottom of the migration, replacing the
   email placeholder with the exact Auth user's email.
5. Create additional Auth users in the dashboard and link each one to a staff
   or customer row. The `user_profiles` role is authoritative; never accept it
   from a browser request.

## Roles

- `admin`: staff account with administrative access.
- `staff`: manager/attendant account with café operations access.
- `customer`: customer account linked to exactly one customer record.

The login page supports existing accounts; account creation and customer
self-registration are intentionally handled by the commerce workstream.

## Database API access and RLS scope

The migration enables RLS and revokes direct `anon`/`authenticated` table
and sequence privileges only for the eleven application tables present in the
current schema: `user_profiles`, `customers`, `staff`, `gaming_pcs`,
`game_categories`, `games`, `tournaments`, `maintenance_records`,
`gaming_sessions`, `session_games`, and `tournament_registrations`.

There are deliberately no RLS policies for these tables because this app does
not use the Supabase Data API for application data. It uses the server-side
PostgreSQL pool after verifying the Supabase Auth identity and role mapping.
The migration does not alter Supabase Auth objects, unrelated public tables,
functions, sequences, or schema-wide default privileges.

Each later feature migration must explicitly enable RLS and revoke the required
direct grants for each new application table and sequence it creates. If a
future feature deliberately uses the Supabase Data API, it must add narrowly
scoped policies and grants for that feature and be reviewed before use.

## Security model

Supabase Auth verifies identity using `auth.getUser()`. The application then
loads the role mapping from PostgreSQL using a parameterized query. Page and
API guards enforce roles on the server. Customer ownership checks must use the
`customerId` from the verified server profile, never a request-body ID.

Because the server PostgreSQL role is privileged and may bypass RLS, RLS is
defense in depth for direct Data API clients, not a replacement for server-side
authorization and ownership filters. Do not expose `DATABASE_URL` or a
database password to client code.

## Verification

Automated tests cover role/profile decisions, email validation, and the SQL
migration's effects in a disposable PostgreSQL database. They do not perform
a live Supabase email/password sign-in because that requires a configured
Supabase project and test user.

Before deployment, also smoke-test with one disposable Supabase project:
- Unauthenticated requests to protected pages redirect to `/login`.
- Unauthenticated API requests return HTTP 401.
- Authenticated users without a valid linked profile, or with the wrong role,
  receive HTTP 403 or are redirected to `/forbidden`.
- Admin and staff can access the internal dashboard; customers cannot.
- Sign out clears the Supabase Auth session.
- The root route sends staff/admin users to `/dashboard`.
