-- ============================================================================
-- Migration 005: Database-enforced role-based access control (RBAC)
-- Apply once, AFTER migrations 001 through 004.
--
-- The Next.js server verifies Supabase Auth using auth.getUser(), resolves the
-- protected user_profiles row, and starts each application query/transaction
-- under one of gamehub_admin, gamehub_staff, or gamehub_customer. The database
-- role is NOLOGIN/NOBYPASSRLS; PostgreSQL RLS policies enforce ownership and
-- permissions even if a route omits an application-level filter.
--
-- The postgres login remains the trusted migration/maintenance principal.
-- Application queries must use the scoped adapter in src/lib/db.ts.
-- ============================================================================

-- 1. Create non-login roles. The three app roles inherit only the table
-- privileges granted to gamehub_runtime; none can bypass RLS or log in directly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gamehub_runtime') THEN
    CREATE ROLE gamehub_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gamehub_admin') THEN
    CREATE ROLE gamehub_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gamehub_staff') THEN
    CREATE ROLE gamehub_staff NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gamehub_customer') THEN
    CREATE ROLE gamehub_customer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT gamehub_runtime TO gamehub_admin, gamehub_staff, gamehub_customer;

-- Supabase's standard project database login is "postgres". It is the trusted
-- server credential already used by DATABASE_URL and may SET LOCAL ROLE.
GRANT gamehub_admin, gamehub_staff, gamehub_customer TO postgres;

-- 2. Transaction-local identity helpers. Identity is populated only by the
-- server after supabase.auth.getUser() verifies the cookie-backed session.
CREATE SCHEMA IF NOT EXISTS app_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO gamehub_runtime;

CREATE OR REPLACE FUNCTION app_private.current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(pg_catalog.current_setting('gamehub.user_id', TRUE), '')::UUID;
$function$;

CREATE OR REPLACE FUNCTION app_private.current_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT up.role
  FROM public.user_profiles AS up
  WHERE up.auth_user_id = app_private.current_user_id()
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION app_private.current_customer_id()
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT up.customer_id
  FROM public.user_profiles AS up
  WHERE up.auth_user_id = app_private.current_user_id()
    AND up.role = 'customer'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION app_private.current_staff_id()
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT up.staff_id
  FROM public.user_profiles AS up
  WHERE up.auth_user_id = app_private.current_user_id()
    AND up.role IN ('admin', 'staff')
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION app_private.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.current_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.current_customer_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.current_staff_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.current_user_id() TO gamehub_runtime;
GRANT EXECUTE ON FUNCTION app_private.current_role() TO gamehub_runtime;
GRANT EXECUTE ON FUNCTION app_private.current_customer_id() TO gamehub_runtime;
GRANT EXECUTE ON FUNCTION app_private.current_staff_id() TO gamehub_runtime;


-- The capacity trigger must count registrations belonging to every customer.
-- Run only this internal trigger function as its owner; application tables
-- remain protected by RLS for all direct application queries.
CREATE OR REPLACE FUNCTION public.games_guard_tournament_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_status TEXT;
  v_max_participants INTEGER;
  v_deadline TIMESTAMPTZ;
  v_start_date DATE;
  v_current_count INTEGER;
BEGIN
  SELECT status, max_participants, registration_deadline, start_date
  INTO v_status, v_max_participants, v_deadline, v_start_date
  FROM public.tournaments
  WHERE tournament_id = NEW.tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament does not exist' USING ERRCODE = '23503';
  END IF;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'Tournament is not open for registration (status: %)', v_status
      USING ERRCODE = '23514';
  END IF;

  IF v_deadline IS NOT NULL AND CURRENT_TIMESTAMP > v_deadline THEN
    RAISE EXCEPTION 'Tournament registration deadline has passed' USING ERRCODE = '23514';
  END IF;

  IF v_start_date IS NOT NULL AND CURRENT_DATE >= v_start_date THEN
    RAISE EXCEPTION 'Tournament has already started' USING ERRCODE = '23514';
  END IF;

  IF v_max_participants IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER
    INTO v_current_count
    FROM public.tournament_registrations
    WHERE tournament_id = NEW.tournament_id;

    IF v_current_count >= v_max_participants THEN
      RAISE EXCEPTION 'Tournament capacity reached (% participants max)', v_max_participants
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.games_guard_tournament_registration()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.games_guard_tournament_registration()
  TO gamehub_runtime;

-- 3. Give the non-bypass runtime role SQL privileges. RLS below is the
-- authorization boundary; these grants alone do not expose other users' rows.
GRANT USAGE ON SCHEMA public TO gamehub_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
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
  public.tournament_registrations,
  public.reservations,
  public.membership_plans,
  public.customer_memberships,
  public.snack_items,
  public.orders,
  public.order_items,
  public.payments
TO gamehub_runtime;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO gamehub_runtime;

-- The active-membership and snack-sales views were initially created as
-- owner-context views. Switch them to invoker security before granting access,
-- so underlying RLS policies also apply to the caller.
ALTER VIEW public.vw_active_customer_memberships SET (security_invoker = TRUE);
ALTER VIEW public.vw_snack_sales_summary SET (security_invoker = TRUE);

GRANT SELECT ON TABLE
  public.vw_active_customer_memberships,
  public.vw_snack_sales_summary,
  public.vw_popular_games,
  public.vw_pc_usage_summary
TO gamehub_runtime;

-- Daily revenue is intentionally Admin-only at the PostgreSQL grant layer.
GRANT SELECT ON TABLE public.vw_daily_revenue TO gamehub_admin;

-- Existing app-callable business function. Trigger functions execute as part
-- of their triggering statement and are not exposed as general API endpoints.
GRANT EXECUTE ON FUNCTION public.commerce_get_customer_discount_percent(INTEGER)
TO gamehub_runtime;

-- Future tables/sequences created by the postgres migration principal receive
-- base privileges, but must still have RLS explicitly enabled and policies added.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gamehub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO gamehub_runtime;

-- 4. Enable RLS on every application table, including tables introduced by
-- commerce and operations migrations.
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
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 5. Drop/recreate named policies so this migration is safe to reapply.

-- Profiles: a user can read only their own role mapping; Admin can audit all.
DROP POLICY IF EXISTS gamehub_profiles_select ON public.user_profiles;
CREATE POLICY gamehub_profiles_select ON public.user_profiles
  FOR SELECT TO gamehub_runtime
  USING (
    auth_user_id = app_private.current_user_id()
    OR app_private.current_role() = 'admin'
  );

-- Customers: staff/Admin manage the directory; a customer sees/updates only self.
DROP POLICY IF EXISTS gamehub_customers_select ON public.customers;
CREATE POLICY gamehub_customers_select ON public.customers
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  );
DROP POLICY IF EXISTS gamehub_customers_insert ON public.customers;
CREATE POLICY gamehub_customers_insert ON public.customers
  FOR INSERT TO gamehub_runtime
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS gamehub_customers_update ON public.customers;
CREATE POLICY gamehub_customers_update ON public.customers
  FOR UPDATE TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  )
  WITH CHECK (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  );
DROP POLICY IF EXISTS gamehub_customers_delete ON public.customers;
CREATE POLICY gamehub_customers_delete ON public.customers
  FOR DELETE TO gamehub_runtime
  USING (app_private.current_role() = 'admin');

-- Staff directory: Admin manages it; staff can read their own staff record.
DROP POLICY IF EXISTS gamehub_staff_select ON public.staff;
CREATE POLICY gamehub_staff_select ON public.staff
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() = 'admin'
    OR staff_id = app_private.current_staff_id()
  );
DROP POLICY IF EXISTS gamehub_staff_manage ON public.staff;
CREATE POLICY gamehub_staff_manage ON public.staff
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() = 'admin')
  WITH CHECK (app_private.current_role() = 'admin');

-- PCs are visible to all logged-in roles; only Admin/Staff may change them.
DROP POLICY IF EXISTS gamehub_pcs_select ON public.gaming_pcs;
CREATE POLICY gamehub_pcs_select ON public.gaming_pcs
  FOR SELECT TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff', 'customer'));
DROP POLICY IF EXISTS gamehub_pcs_manage ON public.gaming_pcs;
CREATE POLICY gamehub_pcs_manage ON public.gaming_pcs
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff'))
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));

-- Categories are readable to all authenticated users and writable by Admin.
DROP POLICY IF EXISTS gamehub_categories_select ON public.game_categories;
CREATE POLICY gamehub_categories_select ON public.game_categories
  FOR SELECT TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff', 'customer'));
DROP POLICY IF EXISTS gamehub_categories_manage ON public.game_categories;
CREATE POLICY gamehub_categories_manage ON public.game_categories
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() = 'admin')
  WITH CHECK (app_private.current_role() = 'admin');

-- Active games are visible to all; archived games are Admin-only.
DROP POLICY IF EXISTS gamehub_games_select ON public.games;
CREATE POLICY gamehub_games_select ON public.games
  FOR SELECT TO gamehub_runtime
  USING (
    is_active = TRUE
    OR app_private.current_role() = 'admin'
  );
DROP POLICY IF EXISTS gamehub_games_manage ON public.games;
CREATE POLICY gamehub_games_manage ON public.games
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() = 'admin')
  WITH CHECK (app_private.current_role() = 'admin');

-- Non-draft tournament details are visible to customers; Admin/Staff manage.
DROP POLICY IF EXISTS gamehub_tournaments_select ON public.tournaments;
CREATE POLICY gamehub_tournaments_select ON public.tournaments
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR status <> 'draft'
  );
DROP POLICY IF EXISTS gamehub_tournaments_manage ON public.tournaments;
CREATE POLICY gamehub_tournaments_manage ON public.tournaments
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff'))
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));

-- Maintenance records are internal operational data.
DROP POLICY IF EXISTS gamehub_maintenance_manage ON public.maintenance_records;
CREATE POLICY gamehub_maintenance_manage ON public.maintenance_records
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff'))
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));

-- Customers may read only their own sessions. Staff/Admin manage sessions.
DROP POLICY IF EXISTS gamehub_sessions_select ON public.gaming_sessions;
CREATE POLICY gamehub_sessions_select ON public.gaming_sessions
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  );
DROP POLICY IF EXISTS gamehub_sessions_insert ON public.gaming_sessions;
CREATE POLICY gamehub_sessions_insert ON public.gaming_sessions
  FOR INSERT TO gamehub_runtime
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS gamehub_sessions_update ON public.gaming_sessions;
CREATE POLICY gamehub_sessions_update ON public.gaming_sessions
  FOR UPDATE TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff'))
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS gamehub_sessions_delete ON public.gaming_sessions;
CREATE POLICY gamehub_sessions_delete ON public.gaming_sessions
  FOR DELETE TO gamehub_runtime
  USING (app_private.current_role() = 'admin');

-- Session/game links are readable with the parent session and writable by staff.
DROP POLICY IF EXISTS gamehub_session_games_select ON public.session_games;
CREATE POLICY gamehub_session_games_select ON public.session_games
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1 FROM public.gaming_sessions AS gs
      WHERE gs.session_id = session_games.session_id
        AND gs.customer_id = app_private.current_customer_id()
    )
  );
DROP POLICY IF EXISTS gamehub_session_games_manage ON public.session_games;
CREATE POLICY gamehub_session_games_manage ON public.session_games
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff'))
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));

-- A customer may see/register/cancel only their own tournament registration.
DROP POLICY IF EXISTS gamehub_tournament_registrations_select ON public.tournament_registrations;
CREATE POLICY gamehub_tournament_registrations_select ON public.tournament_registrations
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  );
DROP POLICY IF EXISTS gamehub_tournament_registrations_insert ON public.tournament_registrations;
CREATE POLICY gamehub_tournament_registrations_insert ON public.tournament_registrations
  FOR INSERT TO gamehub_runtime
  WITH CHECK (
    app_private.current_role() IN ('admin', 'staff')
    OR (
      app_private.current_role() = 'customer'
      AND customer_id = app_private.current_customer_id()
    )
  );
DROP POLICY IF EXISTS gamehub_tournament_registrations_delete ON public.tournament_registrations;
CREATE POLICY gamehub_tournament_registrations_delete ON public.tournament_registrations
  FOR DELETE TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR (
      app_private.current_role() = 'customer'
      AND customer_id = app_private.current_customer_id()
    )
  );

-- Reservations: customer ownership for reads; staff/Admin create and manage.
DROP POLICY IF EXISTS gamehub_reservations_select ON public.reservations;
CREATE POLICY gamehub_reservations_select ON public.reservations
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  );
DROP POLICY IF EXISTS gamehub_reservations_insert ON public.reservations;
CREATE POLICY gamehub_reservations_insert ON public.reservations
  FOR INSERT TO gamehub_runtime
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS gamehub_reservations_manage ON public.reservations;
CREATE POLICY gamehub_reservations_manage ON public.reservations
  FOR UPDATE TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff'))
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS gamehub_reservations_delete ON public.reservations;
CREATE POLICY gamehub_reservations_delete ON public.reservations
  FOR DELETE TO gamehub_runtime
  USING (app_private.current_role() = 'admin');

-- Membership plans: customers see active plans; staff/Admin see/manage catalogue.
DROP POLICY IF EXISTS gamehub_membership_plans_select ON public.membership_plans;
CREATE POLICY gamehub_membership_plans_select ON public.membership_plans
  FOR SELECT TO gamehub_runtime
  USING (
    is_active = TRUE
    OR app_private.current_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1 FROM public.customer_memberships AS cm
      WHERE cm.plan_id = membership_plans.plan_id
        AND cm.customer_id = app_private.current_customer_id()
    )
  );
DROP POLICY IF EXISTS gamehub_membership_plans_manage ON public.membership_plans;
CREATE POLICY gamehub_membership_plans_manage ON public.membership_plans
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() = 'admin')
  WITH CHECK (app_private.current_role() = 'admin');

-- Membership history is customer-owned; staff/Admin can service all accounts.
DROP POLICY IF EXISTS gamehub_memberships_select ON public.customer_memberships;
CREATE POLICY gamehub_memberships_select ON public.customer_memberships
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  );
DROP POLICY IF EXISTS gamehub_memberships_insert ON public.customer_memberships;
CREATE POLICY gamehub_memberships_insert ON public.customer_memberships
  FOR INSERT TO gamehub_runtime
  WITH CHECK (
    app_private.current_role() IN ('admin', 'staff')
    OR (
      app_private.current_role() = 'customer'
      AND customer_id = app_private.current_customer_id()
    )
  );
DROP POLICY IF EXISTS gamehub_memberships_update ON public.customer_memberships;
CREATE POLICY gamehub_memberships_update ON public.customer_memberships
  FOR UPDATE TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR (
      app_private.current_role() = 'customer'
      AND customer_id = app_private.current_customer_id()
      AND status = 'active'
      AND end_at <= CURRENT_TIMESTAMP
    )
  )
  WITH CHECK (
    app_private.current_role() IN ('admin', 'staff')
    OR (
      app_private.current_role() = 'customer'
      AND customer_id = app_private.current_customer_id()
      AND status = 'expired'
      AND end_at <= CURRENT_TIMESTAMP
    )
  );
DROP POLICY IF EXISTS gamehub_memberships_delete ON public.customer_memberships;
CREATE POLICY gamehub_memberships_delete ON public.customer_memberships
  FOR DELETE TO gamehub_runtime
  USING (app_private.current_role() = 'admin');

-- Active snack catalogue is visible to customers; only staff/Admin manage it.
DROP POLICY IF EXISTS gamehub_snacks_select ON public.snack_items;
CREATE POLICY gamehub_snacks_select ON public.snack_items
  FOR SELECT TO gamehub_runtime
  USING (
    is_active = TRUE
    OR app_private.current_role() IN ('admin', 'staff')
  );
DROP POLICY IF EXISTS gamehub_snacks_manage ON public.snack_items;
CREATE POLICY gamehub_snacks_manage ON public.snack_items
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff'))
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));

-- Orders: customers see/create their own orders; only staff/Admin can change
-- order status or service another customer's order. Payment triggers still guard
-- pending -> paid/refunded state transitions and inventory deduction.
DROP POLICY IF EXISTS gamehub_orders_select ON public.orders;
CREATE POLICY gamehub_orders_select ON public.orders
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  );
DROP POLICY IF EXISTS gamehub_orders_insert ON public.orders;
CREATE POLICY gamehub_orders_insert ON public.orders
  FOR INSERT TO gamehub_runtime
  WITH CHECK (
    app_private.current_role() IN ('admin', 'staff')
    OR (
      app_private.current_role() = 'customer'
      AND customer_id = app_private.current_customer_id()
    )
  );
DROP POLICY IF EXISTS gamehub_orders_update ON public.orders;
CREATE POLICY gamehub_orders_update ON public.orders
  FOR UPDATE TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  )
  WITH CHECK (
    app_private.current_role() IN ('admin', 'staff')
    OR customer_id = app_private.current_customer_id()
  );
DROP POLICY IF EXISTS gamehub_orders_delete ON public.orders;
CREATE POLICY gamehub_orders_delete ON public.orders
  FOR DELETE TO gamehub_runtime
  USING (app_private.current_role() = 'admin');

-- Order items inherit ownership from the parent order and can be edited only
-- while the order is pending (also enforced by commerce triggers).
DROP POLICY IF EXISTS gamehub_order_items_select ON public.order_items;
CREATE POLICY gamehub_order_items_select ON public.order_items
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.order_id = order_items.order_id
        AND o.customer_id = app_private.current_customer_id()
    )
  );
DROP POLICY IF EXISTS gamehub_order_items_insert ON public.order_items;
CREATE POLICY gamehub_order_items_insert ON public.order_items
  FOR INSERT TO gamehub_runtime
  WITH CHECK (
    app_private.current_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.order_id = order_items.order_id
        AND o.customer_id = app_private.current_customer_id()
        AND o.status = 'pending'
    )
  );
DROP POLICY IF EXISTS gamehub_order_items_update ON public.order_items;
CREATE POLICY gamehub_order_items_update ON public.order_items
  FOR UPDATE TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.order_id = order_items.order_id
        AND o.customer_id = app_private.current_customer_id()
        AND o.status = 'pending'
    )
  )
  WITH CHECK (
    app_private.current_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.order_id = order_items.order_id
        AND o.customer_id = app_private.current_customer_id()
        AND o.status = 'pending'
    )
  );
DROP POLICY IF EXISTS gamehub_order_items_delete ON public.order_items;
CREATE POLICY gamehub_order_items_delete ON public.order_items
  FOR DELETE TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.order_id = order_items.order_id
        AND o.customer_id = app_private.current_customer_id()
        AND o.status = 'pending'
    )
  );

-- Payments: own-order visibility for customers; creation and state changes are
-- restricted to staff/Admin (and constrained further by payment triggers).
DROP POLICY IF EXISTS gamehub_payments_select ON public.payments;
CREATE POLICY gamehub_payments_select ON public.payments
  FOR SELECT TO gamehub_runtime
  USING (
    app_private.current_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.order_id = payments.order_id
        AND o.customer_id = app_private.current_customer_id()
    )
  );
DROP POLICY IF EXISTS gamehub_payments_manage ON public.payments;
CREATE POLICY gamehub_payments_manage ON public.payments
  FOR ALL TO gamehub_runtime
  USING (app_private.current_role() IN ('admin', 'staff'))
  WITH CHECK (app_private.current_role() IN ('admin', 'staff'));

-- 6. Keep direct PostgREST access closed. The Next.js server uses DATABASE_URL
-- with the database role switched locally; browser clients use only the
-- publishable key and Supabase Auth.
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
  public.tournament_registrations,
  public.reservations,
  public.membership_plans,
  public.customer_memberships,
  public.snack_items,
  public.orders,
  public.order_items,
  public.payments,
  public.vw_active_customer_memberships,
  public.vw_snack_sales_summary,
  public.vw_popular_games,
  public.vw_pc_usage_summary,
  public.vw_daily_revenue
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Explicit statement for reviewers: app roles cannot bypass row-level security.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname IN ('gamehub_runtime', 'gamehub_admin', 'gamehub_staff', 'gamehub_customer')
      AND (rolsuper OR rolbypassrls OR rolcanlogin)
  ) THEN
    RAISE EXCEPTION 'GameHub runtime roles must remain NOLOGIN, NOSUPERUSER and NOBYPASSRLS';
  END IF;
END
$$;
