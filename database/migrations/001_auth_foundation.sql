-- Authentication foundation for Gaming Cafe Management.
-- Run after the existing schema.sql, seed.sql and mvp_migration.sql.
-- Supabase Auth owns credentials; this table maps authenticated users to app roles.

CREATE TABLE IF NOT EXISTS public.user_profiles (
    auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'customer')),
    staff_id INTEGER UNIQUE REFERENCES public.staff(staff_id) ON DELETE RESTRICT,
    customer_id INTEGER UNIQUE REFERENCES public.customers(customer_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_profiles_role_link_check CHECK (
        (role IN ('admin', 'staff') AND staff_id IS NOT NULL AND customer_id IS NULL)
        OR
        (role = 'customer' AND customer_id IS NOT NULL AND staff_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS user_profiles_role_idx
    ON public.user_profiles(role);

COMMENT ON TABLE public.user_profiles IS
    'Maps verified Supabase Auth users to application roles and existing staff/customer records.';

-- Lock down the Supabase Data API. The application accesses these tables through
-- the server-side PostgreSQL pool, so every API must still enforce role and row ownership.
DO $$
DECLARE
    table_record RECORD;
BEGIN
    FOR table_record IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_record.tablename);
    END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Bootstrap the first administrator only after creating that person in
-- Supabase Dashboard > Authentication > Users. Replace the email below and run:
--
-- INSERT INTO public.user_profiles (auth_user_id, role, staff_id)
-- SELECT u.id, 'admin', s.staff_id
-- FROM auth.users AS u
-- CROSS JOIN LATERAL (
--   SELECT staff_id FROM public.staff WHERE name = 'Cafe Admin'
--   ORDER BY staff_id LIMIT 1
-- ) AS s
-- WHERE lower(u.email) = lower('YOUR_ADMIN_EMAIL@example.com')
-- ON CONFLICT (auth_user_id) DO NOTHING;
--
-- For staff, insert role='staff' and the matching staff_id.
-- For customers, create the customer row first, then insert role='customer'
-- with customer_id. Never accept role or ownership IDs from browser input.
