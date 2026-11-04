# Authentication and security setup

## Environment and secrets

Copy `.env.example` to `.env.local` and fill in the project URL, publishable key and server-side PostgreSQL connection string. Never commit `.env.local`, a database password or a Supabase secret/service-role key.

`DATABASE_URL` is server-only and is used by `src/lib/db.ts`. Use the Supabase session pooler connection string and verify the actual database role before applying migrations:

```sql
SELECT current_user, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
```

The expected privileged project role should bypass RLS. Do not disable RLS to make application queries work; the server must verify role/ownership before using the privileged pool. Use a separate disposable `TEST_DATABASE_URL` for automated tests.

If a database password has ever been pasted into chat, a ticket, a commit or another shared location, rotate it in the Supabase dashboard before continuing.

## Provisioning

1. Enable Email/Password under Supabase Dashboard → Authentication → Providers.
2. Create an Admin, Staff and Customer Auth user under Authentication → Users.
3. Create/link their domain records first in `staff` or `customers`.
4. Insert the mapping below using the exact Auth UUID from the dashboard. Do not take the role or UUID from a browser request.

Admin example:

```sql
INSERT INTO public.user_profiles (auth_user_id, role, staff_id)
SELECT '00000000-0000-0000-0000-000000000000'::uuid, 'admin', s.staff_id
FROM public.staff s
WHERE s.name = 'Cafe Admin'
ORDER BY s.staff_id
LIMIT 1;
```

Staff example:

```sql
INSERT INTO public.user_profiles (auth_user_id, role, staff_id)
SELECT '00000000-0000-0000-0000-000000000000'::uuid, 'staff', s.staff_id
FROM public.staff s
WHERE s.staff_id = 2;
```

Customer example:

```sql
INSERT INTO public.user_profiles (auth_user_id, role, customer_id)
SELECT '00000000-0000-0000-0000-000000000000'::uuid, 'customer', c.customer_id
FROM public.customers c
WHERE c.customer_id = 1;
```

The UUIDs and IDs above are placeholders/examples; replace them with the intended test user's real Auth UUID and domain record. Customer self-signup is optional and is not implemented in this module; create the Auth user and mapping through this controlled provisioning flow.

## Authorization contract

- `getCurrentUserProfile()` calls `supabase.auth.getUser()` and then loads `user_profiles` with a parameterised server query.
- `requireApiRole(allowedRoles)` returns `{ profile }` on success or `{ response }` (401/403) on failure.
- `requirePageRole(allowedRoles)` redirects unauthenticated users to `/login` and a wrong-role user to `/forbidden`.
- The authoritative role is `user_profiles.role`. Never accept a role from browser state or Supabase user metadata.
- For customer-owned APIs use `auth.profile.customerId` in the SQL filter. Only admin/staff may submit a customer ID to act on behalf of a customer.

Example:

```ts
const auth = await requireApiRole(["admin", "staff"]);
if (auth.response) return auth.response;
const actor = auth.profile;
```

## RLS and Data API access

Migration 001 applies RLS and revokes direct Data API privileges for the original application tables. Migration 002 does the same for every Commerce table, view, sequence and function it creates. There are no client-facing RLS policies because domain data is accessed through the server-side `pg` pool, not the Supabase REST Data API.

RLS does not protect queries made by the privileged server pool if its role bypasses RLS. Role checks and customer ownership predicates in server routes are mandatory. Never expose `DATABASE_URL` or a service-role key to the browser.

## Sign-out and manual verification

Sign-out is handled through the server route that clears the Supabase SSR session. Use three test identities (admin, staff and customer) and verify:

- unauthenticated API calls return 401;
- admin can manage all allowed Commerce features;
- staff cannot manage membership plans or application roles;
- customers see only their own customer row, memberships and orders;
- customer-supplied `role` or `customerId` fields cannot elevate access or change ownership;
- customer payments cannot be marked paid/refunded;
- signing out invalidates the protected session.

The manual browser-session status belongs in `docs/testing/commerce-auth-test-cases.md`; do not mark a scenario passed until it has actually been run against the configured Supabase project.
