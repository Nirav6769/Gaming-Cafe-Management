-- Commerce module migration. Apply after 001_auth_foundation.sql.
-- This migration is independent of 003_operations.sql.
-- No payment gateway is connected; payment methods are academic/demo records.

-- Purposeful forward alteration of the existing customer entity.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION public.commerce_touch_customer_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_touch_updated_at ON public.customers;
CREATE TRIGGER customers_touch_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.commerce_touch_customer_updated_at();

CREATE TABLE IF NOT EXISTS public.membership_plans (
  plan_id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0 AND duration_days <= 3650),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (discount_percent BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.customer_memberships (
  membership_id BIGSERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES public.customers(customer_id) ON DELETE RESTRICT,
  plan_id BIGINT NOT NULL REFERENCES public.membership_plans(plan_id) ON DELETE RESTRICT,
  start_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'cancelled')),
  price_paid NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_paid >= 0),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'upi_demo', 'card_demo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_at > start_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_memberships_one_active_per_customer_idx
  ON public.customer_memberships(customer_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS customer_memberships_customer_end_idx
  ON public.customer_memberships(customer_id, end_at DESC);
CREATE INDEX IF NOT EXISTS customer_memberships_plan_idx
  ON public.customer_memberships(plan_id);

-- The database, not the browser, decides the membership price and validity dates.
CREATE OR REPLACE FUNCTION public.commerce_snapshot_membership_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  plan_price NUMERIC(10,2);
  plan_duration INTEGER;
BEGIN
  SELECT price, duration_days
  INTO plan_price, plan_duration
  FROM public.membership_plans
  WHERE plan_id = NEW.plan_id AND is_active = TRUE
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership plan is unavailable';
  END IF;

  NEW.start_at := CURRENT_TIMESTAMP;
  NEW.end_at := NEW.start_at + (plan_duration * INTERVAL '1 day');
  NEW.status := 'active';
  NEW.price_paid := plan_price;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_memberships_snapshot_purchase ON public.customer_memberships;
CREATE TRIGGER customer_memberships_snapshot_purchase
BEFORE INSERT ON public.customer_memberships
FOR EACH ROW EXECUTE FUNCTION public.commerce_snapshot_membership_purchase();

CREATE TABLE IF NOT EXISTS public.snack_items (
  snack_id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  description TEXT,
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS snack_items_active_name_idx
  ON public.snack_items(name) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.orders (
  order_id BIGSERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES public.customers(customer_id) ON DELETE RESTRICT,
  created_by UUID REFERENCES public.user_profiles(auth_user_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  discount_percent_snapshot NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (discount_percent_snapshot BETWEEN 0 AND 100),
  inventory_deducted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS orders_customer_created_idx
  ON public.orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created_idx
  ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx
  ON public.orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_items (
  order_item_id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(order_id) ON DELETE RESTRICT,
  snack_id BIGINT NOT NULL REFERENCES public.snack_items(snack_id) ON DELETE RESTRICT,
  item_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_at_purchase NUMERIC(10,2) NOT NULL CHECK (unit_price_at_purchase >= 0),
  line_total NUMERIC(10,2) NOT NULL CHECK (line_total >= 0),
  CHECK (line_total = ROUND(quantity * unit_price_at_purchase, 2))
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_snack_idx ON public.order_items(snack_id);

CREATE TABLE IF NOT EXISTS public.payments (
  payment_id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES public.orders(order_id) ON DELETE RESTRICT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'upi_demo', 'card_demo')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  provider_reference TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS payments_status_created_idx
  ON public.payments(status, created_at DESC);

CREATE OR REPLACE FUNCTION public.commerce_get_customer_discount_percent(
  p_customer_id INTEGER
)
RETURNS NUMERIC(5,2)
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(MAX(mp.discount_percent), 0)::NUMERIC(5,2)
  FROM public.customer_memberships cm
  JOIN public.membership_plans mp ON mp.plan_id = cm.plan_id
  WHERE cm.customer_id = p_customer_id
    AND cm.status = 'active'
    AND CURRENT_TIMESTAMP >= cm.start_at
    AND CURRENT_TIMESTAMP < cm.end_at;
$$;

CREATE OR REPLACE FUNCTION public.commerce_snapshot_order_discount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.discount_percent_snapshot :=
    public.commerce_get_customer_discount_percent(NEW.customer_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_snapshot_membership_discount ON public.orders;
CREATE TRIGGER orders_snapshot_membership_discount
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.commerce_snapshot_order_discount();

-- Freeze the snack name and price on INSERT or snack change. Quantity-only updates
-- retain the original unit_price_at_purchase.
CREATE OR REPLACE FUNCTION public.commerce_guard_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
  snack_name TEXT;
  snack_price NUMERIC(10,2);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION 'An order item cannot be moved to another order';
  END IF;

  SELECT status
  INTO parent_status
  FROM public.orders
  WHERE order_id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order does not exist';
  END IF;
  IF parent_status <> 'pending' THEN
    RAISE EXCEPTION 'Items can only be changed while an order is pending';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.snack_id IS DISTINCT FROM OLD.snack_id THEN
    SELECT name, unit_price
    INTO snack_name, snack_price
    FROM public.snack_items
    WHERE snack_id = NEW.snack_id AND is_active = TRUE
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Snack item is unavailable';
    END IF;

    NEW.item_name_snapshot := snack_name;
    NEW.unit_price_at_purchase := snack_price;
  ELSE
    NEW.item_name_snapshot := OLD.item_name_snapshot;
    NEW.unit_price_at_purchase := OLD.unit_price_at_purchase;
  END IF;

  NEW.line_total := ROUND((NEW.quantity * NEW.unit_price_at_purchase)::NUMERIC, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_guard_and_snapshot ON public.order_items;
CREATE TRIGGER order_items_guard_and_snapshot
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_order_item();

CREATE OR REPLACE FUNCTION public.commerce_guard_order_item_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT status
  INTO parent_status
  FROM public.orders
  WHERE order_id = OLD.order_id
  FOR UPDATE;

  IF NOT FOUND OR parent_status <> 'pending' THEN
    RAISE EXCEPTION 'Only items in a pending order can be deleted';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS order_items_guard_delete ON public.order_items;
CREATE TRIGGER order_items_guard_delete
BEFORE DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_order_item_delete();

CREATE OR REPLACE FUNCTION public.commerce_recalculate_order_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_order_id BIGINT;
  old_order_id BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_order_id := OLD.order_id;
  ELSE
    target_order_id := NEW.order_id;
  END IF;

  UPDATE public.orders o
  SET subtotal = totals.subtotal,
      discount_amount = ROUND(
        (totals.subtotal * o.discount_percent_snapshot / 100)::NUMERIC, 2
      ),
      total_amount = GREATEST(
        totals.subtotal - ROUND(
          (totals.subtotal * o.discount_percent_snapshot / 100)::NUMERIC, 2
        ),
        0
      )
  FROM (
    SELECT COALESCE(SUM(oi.line_total), 0)::NUMERIC(10,2) AS subtotal
    FROM public.order_items oi
    WHERE oi.order_id = target_order_id
  ) totals
  WHERE o.order_id = target_order_id AND o.status = 'pending';

  IF TG_OP = 'UPDATE' AND OLD.order_id <> NEW.order_id THEN
    old_order_id := OLD.order_id;
    UPDATE public.orders o
    SET subtotal = totals.subtotal,
        discount_amount = ROUND(
          (totals.subtotal * o.discount_percent_snapshot / 100)::NUMERIC, 2
        ),
        total_amount = GREATEST(
          totals.subtotal - ROUND(
            (totals.subtotal * o.discount_percent_snapshot / 100)::NUMERIC, 2
          ),
          0
        )
    FROM (
      SELECT COALESCE(SUM(oi.line_total), 0)::NUMERIC(10,2) AS subtotal
      FROM public.order_items oi
      WHERE oi.order_id = old_order_id
    ) totals
    WHERE o.order_id = old_order_id AND o.status = 'pending';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS order_items_recalculate_total ON public.order_items;
CREATE TRIGGER order_items_recalculate_total
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.commerce_recalculate_order_total();

-- Stock is deducted only on pending -> paid, after a matching paid payment exists.
-- The marker and the one-way order state machine make the transition idempotent.
CREATE OR REPLACE FUNCTION public.commerce_guard_order_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  requested RECORD;
  has_items BOOLEAN;
  payment_matches BOOLEAN;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'paid' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.order_id = NEW.order_id
        AND p.status = 'paid'
        AND p.amount = NEW.total_amount
    ) INTO payment_matches;

    IF NOT payment_matches THEN
      RAISE EXCEPTION 'An order can only be marked paid through a matching payment';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.order_items WHERE order_id = NEW.order_id
    ) INTO has_items;

    IF NOT has_items THEN
      RAISE EXCEPTION 'An empty order cannot be paid';
    END IF;

    IF NEW.inventory_deducted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Inventory has already been deducted for this order';
    END IF;

    FOR requested IN
      SELECT snack_id, SUM(quantity)::INTEGER AS quantity
      FROM public.order_items
      WHERE order_id = NEW.order_id
      GROUP BY snack_id
      ORDER BY snack_id
    LOOP
      UPDATE public.snack_items
      SET stock_quantity = stock_quantity - requested.quantity,
          updated_at = CURRENT_TIMESTAMP
      WHERE snack_id = requested.snack_id
        AND is_active = TRUE
        AND stock_quantity >= requested.quantity;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for snack item %', requested.snack_id
          USING ERRCODE = '23514';
      END IF;
    END LOOP;

    NEW.inventory_deducted_at := CURRENT_TIMESTAMP;
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid' AND NEW.status = 'refunded' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.order_id = NEW.order_id AND p.status = 'refunded'
    ) INTO payment_matches;

    IF NOT payment_matches THEN
      RAISE EXCEPTION 'An order can only be refunded through its payment record';
    END IF;

    -- Refunds are demo status changes. Prepared/served snacks are not restocked.
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid order status transition: % to %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS orders_guard_status_transition ON public.orders;
CREATE TRIGGER orders_guard_status_transition
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_order_transition();

CREATE OR REPLACE FUNCTION public.commerce_validate_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  order_status TEXT;
  order_total NUMERIC(10,2);
  has_items BOOLEAN;
BEGIN
  SELECT status, total_amount
  INTO order_status, order_total
  FROM public.orders
  WHERE order_id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order does not exist';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_id <> OLD.order_id THEN
      RAISE EXCEPTION 'A payment cannot be moved to another order';
    END IF;
    IF OLD.status IN ('paid', 'refunded') AND
       (NEW.amount <> OLD.amount OR NEW.method <> OLD.method) THEN
      RAISE EXCEPTION 'A completed payment amount and method cannot be changed';
    END IF;
    IF OLD.status = 'paid' AND NEW.status <> 'refunded' AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'A paid payment can only be refunded';
    END IF;
    IF OLD.status = 'refunded' AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'A refunded payment is final';
    END IF;
  END IF;

  IF NEW.status = 'paid' THEN
    IF order_status <> 'pending' THEN
      RAISE EXCEPTION 'Only a pending order can be paid';
    END IF;
    IF NEW.amount <> order_total THEN
      RAISE EXCEPTION 'Payment amount must match the order total';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.order_items WHERE order_id = NEW.order_id
    ) INTO has_items;
    IF NOT has_items THEN
      RAISE EXCEPTION 'An empty order cannot be paid';
    END IF;
  ELSIF NEW.status = 'refunded' THEN
    IF order_status <> 'paid' THEN
      RAISE EXCEPTION 'Only a paid order can be refunded';
    END IF;
  ELSIF NEW.status = 'pending' AND TG_OP = 'UPDATE' AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment cannot be returned to pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_validate_state ON public.payments;
CREATE TRIGGER payments_validate_state
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.commerce_validate_payment();

CREATE OR REPLACE FUNCTION public.commerce_apply_payment_to_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.orders
    SET status = 'paid'
    WHERE order_id = NEW.order_id AND status = 'pending';
  ELSIF NEW.status = 'refunded' AND
        (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.orders
    SET status = 'refunded'
    WHERE order_id = NEW.order_id AND status = 'paid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_apply_to_order ON public.payments;
CREATE TRIGGER payments_apply_to_order
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.commerce_apply_payment_to_order();

CREATE OR REPLACE VIEW public.vw_active_customer_memberships AS
SELECT
  cm.membership_id,
  cm.customer_id,
  c.name AS customer_name,
  mp.name AS plan_name,
  mp.discount_percent,
  cm.start_at,
  cm.end_at,
  cm.price_paid,
  cm.payment_method
FROM public.customer_memberships cm
JOIN public.customers c ON c.customer_id = cm.customer_id
JOIN public.membership_plans mp ON mp.plan_id = cm.plan_id
WHERE cm.status = 'active'
  AND CURRENT_TIMESTAMP >= cm.start_at
  AND CURRENT_TIMESTAMP < cm.end_at;

CREATE OR REPLACE VIEW public.vw_snack_sales_summary AS
SELECT
  si.snack_id,
  si.name AS snack_name,
  COALESCE(SUM(oi.quantity) FILTER (WHERE o.status IN ('paid', 'refunded')), 0)::BIGINT AS units_sold,
  COALESCE(SUM(oi.line_total) FILTER (WHERE o.status IN ('paid', 'refunded')), 0)::NUMERIC(12,2) AS gross_sales
FROM public.snack_items si
LEFT JOIN public.order_items oi ON oi.snack_id = si.snack_id
LEFT JOIN public.orders o ON o.order_id = oi.order_id
GROUP BY si.snack_id, si.name;

-- Security footer: commerce objects are accessed only through role-checked server APIs.
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.membership_plans,
  public.customer_memberships,
  public.snack_items,
  public.orders,
  public.order_items,
  public.payments,
  public.vw_active_customer_memberships,
  public.vw_snack_sales_summary
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE
  public.membership_plans_plan_id_seq,
  public.customer_memberships_membership_id_seq,
  public.snack_items_snack_id_seq,
  public.orders_order_id_seq,
  public.order_items_order_item_id_seq,
  public.payments_payment_id_seq
FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.commerce_touch_customer_updated_at()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_snapshot_membership_purchase()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_get_customer_discount_percent(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_snapshot_order_discount()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_guard_order_item()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_guard_order_item_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_recalculate_order_total()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_guard_order_transition()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_validate_payment()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_apply_payment_to_order()
  FROM PUBLIC, anon, authenticated;
