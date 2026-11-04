# GameHub — Gaming Cafe Management

A role-aware gaming-cafe management app built with Next.js, TypeScript, PostgreSQL and Supabase Auth.

## Features
- Supabase Auth with Admin, Staff and Customer roles
- Role-protected dashboard and API routes
- Customer directory and customer-scoped customer portal
- Membership plans, membership history and membership discounts
- Snack catalogue, stock management, orders and demo payment/refund records
- PC availability, reservations, gaming sessions and maintenance
- Game catalogue and session analytics (see the integrated Games/Analytics module)

## Requirements
- Node.js 20.9+
- npm
- A Supabase PostgreSQL project

## Database setup

For a fresh Supabase project, run the baseline files once in this order:
1. `database/schema.sql`
2. `database/seed.sql`
3. `database/mvp_migration.sql`

Then run the forward migrations in order:
4. `database/migrations/001_auth_foundation.sql`
5. `database/migrations/002_commerce.sql`
6. `database/migrations/003_operations.sql`
7. Apply the Games/Analytics migration when it is added to the integrated branch.

Do not re-run the non-idempotent baseline schema on a database that already contains the baseline tables. Commerce and Operations both depend on migration 001 but are otherwise independent. Record each migration application in the team's migration log.

Migration 001 creates `user_profiles` and protects the application tables. Migration 002 adds customer timestamps, memberships, snacks, orders and payment records. Migration 003 adds reservations and operational constraints/triggers.

## Local setup
1. Clone the repository and enter the folder.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and configure the Supabase project values:

   ```env
   DATABASE_URL=postgresql://...
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   ```

   Use the Supabase Session Pooler connection string for server-side database access. `DATABASE_URL` must remain server-only. Never commit `.env.local`, database passwords or secret/service-role keys.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open http://localhost:3000/login.

## Verify
- Create test identities in Supabase Dashboard → Authentication → Users, then link each Auth UUID to a row in `user_profiles` using the examples in `docs/security/authentication.md`.
- Sign in as Admin/Staff and verify the dashboard and Operations pages.
- Sign in as Customer and verify the customer-scoped Commerce page.
- Test a snack order with Admin/Staff payment recording; confirm stock is deducted once and a demo refund does not restock it.
- Test reservations and gaming sessions through Operations.

Run checks before pushing:

```bash
npm run lint
npm run build
```

## Authentication and roles

Supabase Auth manages login credentials. The app then looks up the user's role and linked staff/customer record in `public.user_profiles`. Roles are `admin`, `staff` and `customer`; never accept a role or customer owner ID from the browser. Create Auth users through the Supabase dashboard and map them to domain rows as documented in `docs/security/authentication.md`.

Customers can view/update their own profile, membership and orders. Admin/Staff manage customer records and café operations; only Admin manages membership plans. Order payments and refunds are academic/demo records; no payment gateway or card/UPI credentials are used.

## Notes
- API routes use parameterized SQL queries and server-side role/ownership checks.
- Database access is server-side only; RLS blocks direct Supabase Data API access to application tables.
- Billing uses elapsed session time multiplied by the PC hourly rate, rounded to two decimal places.
- Commerce pricing, discounts and inventory rules are enforced in PostgreSQL.
- Payment records are demo-only and are not a real payment integration.
