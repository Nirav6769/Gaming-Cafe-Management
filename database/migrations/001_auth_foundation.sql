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

-- Application data is accessed through the Next.js server-side PostgreSQL pool.
-- Lock down only the application tables that exist in this schema. Auth objects,
-- platform-managed objects, unrelated public objects, functions and defaults remain untouched.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaming_pcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaming_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_registrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
    public.user_profiles,
    public.customers,
    public.staff,
    public.gaming_pcs,
    public.game_categories,
    public.games,
    public.tournaments,
    public.maintenance_records,
    public.gaming_sessions,
    public.session_games,
    public.tournament_registrations
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE
    public.customers_customer_id_seq,
    public.staff_staff_id_seq,
    public.gaming_pcs_pc_id_seq,
    public.game_categories_category_id_seq,
    public.games_game_id_seq,
    public.tournaments_tournament_id_seq,
    public.gaming_sessions_session_id_seq
FROM anon, authenticated;

-- Later feature migrations must explicitly enable RLS and revoke direct grants
-- for every new application table, sequence or callable function they introduce.
-- Do not broaden this migration to the entire public schema by default.

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
