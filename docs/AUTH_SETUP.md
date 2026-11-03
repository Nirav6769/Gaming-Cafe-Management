# Authentication setup

## Environment

Copy `.env.example` to `.env.local` and fill in the Supabase project URL,
publishable key, and server-side PostgreSQL connection string. Never commit
`.env.local`, a database password, or a Supabase secret/service-role key.

Use the Supabase pooler connection string in `DATABASE_URL`. Keep it server-only.
For database tests, configure a separate disposable `TEST_DATABASE_URL`.

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

## Security model

Supabase Auth verifies identity using `auth.getUser()`. The application then
loads the role mapping from PostgreSQL using a parameterized query. Page and
API guards enforce roles on the server. Customer ownership checks must use the
`customerId` from the verified server profile, never a request-body ID.

The migration enables RLS on public tables and removes direct Data API grants
from `anon` and `authenticated`. The application PostgreSQL pool is a
privileged server connection and can bypass RLS; therefore RLS is defense in
depth, not a replacement for server-side authorization and ownership filters.

## Verification

- Unauthenticated requests to protected pages redirect to `/login`.
- Unauthenticated API requests return HTTP 401.
- Authenticated users without a profile, or with the wrong role, receive HTTP 403
  or are redirected to `/forbidden`.
- Sign out clears the Supabase Auth session.
- The root route sends staff/admin users to `/dashboard`.
