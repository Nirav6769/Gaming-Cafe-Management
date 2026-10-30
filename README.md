# GameHub — Gaming Cafe Management

A small gaming-cafe operations app built with Next.js, TypeScript, PostgreSQL and Supabase.

## Features
- Live dashboard: PC counts, active sessions and today's completed-session revenue
- PC availability and maintenance status
- Customer creation and search
- Start/end gaming sessions with server-side billing
- Game catalogue and categories

## Requirements
- Node.js 20.9+
- npm
- A Supabase PostgreSQL project

## Database setup
In the Supabase SQL Editor, run these files in order:
1. `database/schema.sql`
2. `database/seed.sql`
3. `database/mvp_migration.sql`

The migration adds a partial unique index so a PC cannot have more than one active session.

## Local setup
1. Clone the repository and enter the folder.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `.env.local` in the project root and add your Supabase PostgreSQL connection string:

   ```env
   DATABASE_URL=postgresql://...
   ```

   Use the Supabase Session Pooler connection string for serverless hosting. Never commit `.env.local`.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open http://localhost:3000.

## Verify
- Dashboard should load PC counts from the database.
- Add a customer under Customers.
- Start a session for that customer on an available PC.
- Confirm that PC changes to occupied.
- End the session and confirm that the PC becomes available and a bill is recorded.

Run checks before pushing:

```bash
npm run lint
npm run build
```

## Notes
- API routes use parameterized SQL queries.
- Database access is server-side only.
- Billing uses elapsed session time multiplied by the PC hourly rate, rounded to two decimal places.
- This MVP does not yet include authentication, payment processing, role-based access control, or tournament registration.
