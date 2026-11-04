-- Commerce module migration. Apply after 001_auth_foundation.sql.
-- This migration is independent of 003_operations.sql.
-- Payments are demo records only: no external gateway or card details are used.

CREATE TABLE IF NOT EXISTS public.membership_plans (
  plan_id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (discount_percent BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.memberships (
  membership_id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES public.customers(customer_id) ON DELETE RESTRICT,
  plan_id INTEGER NOT NULL REFERENCES public.membership_plans(plan_id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'cancelled')),
  price_paid NUMERIC(10,2) NOT NULL CHECK (price_paid >= 0),
  created_by_staff_id INTEGER REFERENCES public.staff(staff_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_active_per_customer_idx
  ON public.memberships(customer_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS memberships_customer_end_idx
  ON public.memberships(customer_id, ends_at DESC);

CREATE TABLE IF NOT EXISTS public.snack_items (
  snack_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS snack_items_active_name_idx
  ON public.snack_items(name) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.orders (
  order_id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES public.customers(customer_id) ON DELETE RESTRICT,
  created_by_staff_id INTEGER REFERENCES public.staff(staff_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'placed', 'fulfilled', 'cancelled')),
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (discount_percent BETWEEN 0 AND 100),
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  notes VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  placed_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS orders_customer_created_idx
  ON public.orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx
  ON public.orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_items (
  order_item_id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES public.orders(order_id) ON DELETE CASCADE,
  snack_id INTEGER NOT NULL REFERENCES public.snack_items(snack_id) ON DELETE RESTRICT,
  item_name_snapshot VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(10,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_snack_idx ON public.order_items(snack_id);

CREATE TABLE IF NOT EXISTS public.payments (
  payment_id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES public.orders(order_id) ON DELETE RESTRICT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'demo')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'succeeded', 'failed', 'refunded')),
  transaction_reference VARCHAR(100) NOT NULL UNIQUE,
  note VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_success_per_order_idx
  ON public.payments(order_id) WHERE payment_status = 'succeeded';
CREATE INDEX IF NOT EXISTS payments_order_created_idx
  ON public.payments(order_id, created_at DESC);

-- The active discount is derived from the customer's currently valid membership.
CREATE OR REPLACE FUNCTION public.commerce_active_membership_discount(
  p_customer_id INTEGER,
  p_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(MAX(mp.discount_percent), 0)::NUMERIC(5,2)
  FROM public.memberships m
  JOIN public.membership_plans mp ON mp.plan_id = m.plan_id
  WHERE m.customer_id = p_customer_id
    AND m.status = 'active'
    AND m.starts_at <= p_at
    AND m.ends_at > p_at;
$$;

CREATE OR REPLACE FUNCTION public.commerce_snapshot_order_discount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.discount_percent :=
    public.commerce_active_membership_discount(NEW.customer_id, CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_snapshot_membership_discount ON public.orders;
CREATE TRIGGER orders_snapshot_membership_discount
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.commerce_snapshot_order_discount();

CREATE OR REPLACE FUNCTION public.commerce_snapshot_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  snack_name TEXT;
  snack_price NUMERIC(10,2);
  item_status TEXT;
BEGIN
  SELECT status INTO item_status
  FROM public.orders
  WHERE order_id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order does not exist';
  END IF;
  IF item_status <> 'draft' THEN
    RAISE EXCEPTION 'Items can only be changed while an order is a draft';
  END IF;

  IF TG_OP = 'UPDATE' AND
     (NEW.order_id <> OLD.order_id OR NEW.snack_id <> OLD.snack_id) THEN
    RAISE EXCEPTION 'An order item cannot be moved to another order or snack';
  END IF;

  SELECT name, unit_price
  INTO snack_name, snack_price
  FROM public.snack_items
  WHERE snack_id = NEW.snack_id AND is_active = TRUE
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snack item is unavailable';
  END IF;

  NEW.item_name_snapshot := snack_name;
  NEW.unit_price := snack_price;
  NEW.line_total := ROUND((NEW.quantity * snack_price)::NUMERIC, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_snapshot_price ON public.order_items;
CREATE TRIGGER order_items_snapshot_price
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.commerce_snapshot_order_item();

CREATE OR REPLACE FUNCTION public.commerce_recalculate_order_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_order_id INTEGER;
  old_order_id INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_order_id := OLD.order_id;
  ELSE
    target_order_id := NEW.order_id;
  END IF;

  UPDATE public.orders o
  SET subtotal = totals.subtotal,
      discount_amount = ROUND((totals.subtotal * o.discount_percent / 100)::NUMERIC, 2),
      total_amount = GREATEST(
        totals.subtotal - ROUND((totals.subtotal * o.discount_percent / 100)::NUMERIC, 2),
        0
      )
  FROM (
    SELECT COALESCE(SUM(oi.line_total), 0)::NUMERIC(10,2) AS subtotal
    FROM public.order_items oi
    WHERE oi.order_id = target_order_id
  ) totals
  WHERE o.order_id = target_order_id;

  IF TG_OP = 'UPDATE' AND OLD.order_id <> NEW.order_id THEN
    old_order_id := OLD.order_id;
    UPDATE public.orders o
    SET subtotal = totals.subtotal,
        discount_amount = ROUND((totals.subtotal * o.discount_percent / 100)::NUMERIC, 2),
        total_amount = GREATEST(
          totals.subtotal - ROUND((totals.subtotal * o.discount_percent / 100)::NUMERIC, 2),
          0
        )
    FROM (
      SELECT COALESCE(SUM(oi.line_total), 0)::NUMERIC(10,2) AS subtotal
      FROM public.order_items oi
      WHERE oi.order_id = old_order_id
    ) totals
    WHERE o.order_id = old_order_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS order_items_recalculate_total ON public.order_items;
CREATE TRIGGER order_items_recalculate_total
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.commerce_recalculate_order_total();

-- Inventory is decremented once, atomically, only when a draft is placed.
-- Cancellation after placement does not automatically restock inventory.
CREATE OR REPLACE FUNCTION public.commerce_apply_stock_on_order_placement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  requested RECORD;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'placed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.order_items WHERE order_id = NEW.order_id
    ) THEN
      RAISE EXCEPTION 'An empty order cannot be placed';
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

    NEW.placed_at := COALESCE(NEW.placed_at, CURRENT_TIMESTAMP);
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'placed' AND NEW.status IN ('fulfilled', 'cancelled') THEN
    IF NEW.status = 'fulfilled' THEN
      NEW.fulfilled_at := COALESCE(NEW.fulfilled_at, CURRENT_TIMESTAMP);
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid order status transition: % to %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS orders_guard_status_and_stock ON public.orders;
CREATE TRIGGER orders_guard_status_and_stock
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.commerce_apply_stock_on_order_placement();

CREATE OR REPLACE FUNCTION public.commerce_validate_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_status TEXT;
  current_total NUMERIC(10,2);
BEGIN
  SELECT status, total_amount
  INTO current_status, current_total
  FROM public.orders
  WHERE order_id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order does not exist';
  END IF;
  IF current_status NOT IN ('placed', 'fulfilled') THEN
    RAISE EXCEPTION 'Payment can only be recorded for a placed order';
  END IF;
  IF NEW.amount <> current_total THEN
    RAISE EXCEPTION 'Payment amount must match the order total';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_validate_order ON public.payments;
CREATE TRIGGER payments_validate_order
BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.commerce_validate_payment();

CREATE OR REPLACE VIEW public.vw_active_customer_memberships AS
SELECT
  m.membership_id,
  m.customer_id,
  c.name AS customer_name,
  mp.name AS plan_name,
  mp.discount_percent,
  m.starts_at,
  m.ends_at,
  m.price_paid
FROM public.memberships m
JOIN public.customers c ON c.customer_id = m.customer_id
JOIN public.membership_plans mp ON mp.plan_id = m.plan_id
WHERE m.status = 'active'
  AND m.starts_at <= CURRENT_TIMESTAMP
  AND m.ends_at > CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW public.vw_snack_sales_summary AS
SELECT
  si.snack_id,
  si.name AS snack_name,
  COALESCE(SUM(oi.quantity) FILTER (WHERE o.status IN ('placed', 'fulfilled')), 0)::BIGINT AS units_sold,
  COALESCE(SUM(oi.line_total) FILTER (WHERE o.status IN ('placed', 'fulfilled')), 0)::NUMERIC(12,2) AS gross_sales
FROM public.snack_items si
LEFT JOIN public.order_items oi ON oi.snack_id = si.snack_id
LEFT JOIN public.orders o ON o.order_id = oi.order_id
GROUP BY si.snack_id, si.name;

-- Commerce data is served only through authenticated server APIs, not the Supabase Data API.
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.membership_plans,
  public.memberships,
  public.snack_items,
  public.orders,
  public.order_items,
  public.payments,
  public.vw_active_customer_memberships,
  public.vw_snack_sales_summary
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE
  public.membership_plans_plan_id_seq,
  public.memberships_membership_id_seq,
  public.snack_items_snack_id_seq,
  public.orders_order_id_seq,
  public.order_items_order_item_id_seq,
  public.payments_payment_id_seq
FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.commerce_active_membership_discount(INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_snapshot_order_discount()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_snapshot_order_item()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_recalculate_order_total()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_apply_stock_on_order_placement()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_validate_payment()
  FROM PUBLIC, anon, authenticated;
