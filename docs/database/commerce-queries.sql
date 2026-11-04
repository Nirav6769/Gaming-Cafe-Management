-- GameHub Commerce query catalogue
-- Run against a disposable/development database after migrations 001 and 002.
-- Replace example IDs/names with records in your own test data.

-- SELECT + JOIN: customer memberships with their plan information.
SELECT c.customer_id, c.name, mp.name AS plan_name,
       cm.start_at, cm.end_at, cm.status, cm.price_paid
FROM public.customer_memberships cm
JOIN public.customers c ON c.customer_id = cm.customer_id
JOIN public.membership_plans mp ON mp.plan_id = cm.plan_id
ORDER BY cm.created_at DESC;

-- Stored function: active discount is valid only within the date window.
SELECT c.customer_id, c.name,
       public.commerce_get_customer_discount_percent(c.customer_id) AS discount_percent
FROM public.customers c
ORDER BY c.name;

-- INSERT: create a membership. The trigger derives price and dates from the plan.
-- The supplied price is deliberately absent.
INSERT INTO public.customer_memberships (customer_id, plan_id, payment_method)
VALUES (1, 1, 'upi_demo');

-- INSERT: create a snack catalogue item.
INSERT INTO public.snack_items (name, category, description, unit_price, stock_quantity)
VALUES
  ('Example nachos', 'Snacks', 'Demo snack item', 85.00, 20),
  ('Example soda', 'Drinks', 'Demo drink item', 40.00, 20)
ON CONFLICT (name) DO NOTHING;

-- INSERT: create a pending order and its lines in the same transaction.
-- BEFORE INSERT triggers snapshot the membership discount and snack prices.
BEGIN;
WITH created_order AS (
  INSERT INTO public.orders (customer_id)
  VALUES (1)
  RETURNING order_id
)
INSERT INTO public.order_items
  (order_id, snack_id, item_name_snapshot, quantity, unit_price_at_purchase, line_total)
SELECT created_order.order_id, snack.snack_id, '', requested.quantity, 0, 0
FROM created_order
JOIN (VALUES ('Example nachos', 2), ('Example soda', 1))
  AS requested(snack_name, quantity) ON TRUE
JOIN public.snack_items snack ON snack.name = requested.snack_name;
COMMIT;

-- UPDATE: quantity-only update preserves the historical unit price.
UPDATE public.order_items oi
SET quantity = 3
FROM public.orders o, public.snack_items si
WHERE oi.order_id = o.order_id
  AND oi.snack_id = si.snack_id
  AND oi.order_id = 1
  AND si.name = 'Example nachos'
  AND o.status = 'pending';

-- DELETE: only a line in a pending order may be deleted; totals recalculate.
DELETE FROM public.order_items oi
USING public.orders o, public.snack_items si
WHERE oi.order_id = o.order_id
  AND oi.snack_id = si.snack_id
  AND si.name = 'Example soda'
  AND o.order_id = 1
  AND o.status = 'pending';

-- Payment transaction: record pending, then set paid. Payment/order/stock
-- changes are atomic. The amount is read from orders, not typed by the client.
BEGIN;
WITH payment_to_record AS (
  INSERT INTO public.payments (order_id, amount, method, status)
  SELECT o.order_id, o.total_amount, 'cash', 'pending'
  FROM public.orders o
  WHERE o.order_id = 1 AND o.status = 'pending'
  RETURNING payment_id
)
UPDATE public.payments
SET status = 'paid'
WHERE payment_id IN (SELECT payment_id FROM payment_to_record);
COMMIT;

-- UPDATE: demo refund. This changes status only and does not restock snacks.
UPDATE public.payments
SET status = 'refunded'
WHERE payment_id = 1
  AND status = 'paid';

-- Aggregate + GROUP BY: sold units and gross order sales per snack.
SELECT snack_id, snack_name, units_sold, gross_sales
FROM public.vw_snack_sales_summary
ORDER BY gross_sales DESC, snack_name;

-- GROUP BY + HAVING: customers with more than one paid order.
SELECT c.customer_id, c.name, COUNT(*) AS paid_orders,
       SUM(o.total_amount) AS paid_order_value
FROM public.orders o
JOIN public.customers c ON c.customer_id = o.customer_id
WHERE o.status = 'paid'
GROUP BY c.customer_id, c.name
HAVING COUNT(*) > 1
ORDER BY paid_order_value DESC;

-- Subquery: active snacks whose stock is below the average active snack stock.
SELECT si.snack_id, si.name, si.stock_quantity
FROM public.snack_items si
WHERE si.is_active = TRUE
  AND si.stock_quantity < (
    SELECT AVG(si2.stock_quantity)
    FROM public.snack_items si2
    WHERE si2.is_active = TRUE
  )
ORDER BY si.stock_quantity;

-- Subquery + aggregate: total membership revenue, excluding cancelled memberships.
SELECT COALESCE(SUM(cm.price_paid), 0) AS membership_revenue
FROM public.customer_memberships cm
WHERE cm.status <> 'cancelled';

-- Daily snack order revenue. Membership revenue remains available separately
-- from customer_memberships for the combined analytics view.
SELECT DATE(o.created_at) AS order_day,
       COUNT(*) AS paid_order_count,
       SUM(o.subtotal) AS gross_subtotal,
       SUM(o.discount_amount) AS discounts,
       SUM(o.total_amount) AS net_order_revenue
FROM public.orders o
WHERE o.status = 'paid'
GROUP BY DATE(o.created_at)
ORDER BY order_day DESC;

-- Reporting view: current memberships in their validity window.
SELECT * FROM public.vw_active_customer_memberships
ORDER BY end_at, customer_name;
