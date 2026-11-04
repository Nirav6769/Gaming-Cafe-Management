import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { databaseTestSkip, withRollback } from "./helpers/db";

const fixtureSql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'CREATE ROLE anon NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated NOLOGIN';
  END IF;
END
$$;

CREATE TABLE public.customers (
  customer_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);
CREATE TABLE public.staff (
  staff_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);
CREATE TABLE public.unrelated_commerce_test_table (id INTEGER PRIMARY KEY);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
`;

test(
  "commerce migration snapshots prices, discounts and decrements stock once",
  { skip: databaseTestSkip },
  async () => {
    const migration = await readFile(
      resolve(process.cwd(), "database/migrations/002_commerce.sql"),
      "utf8",
    );

    await withRollback(async (client) => {
      await client.query(fixtureSql);
      await client.query(migration);

      const customer = await client.query(
        "INSERT INTO public.customers (name) VALUES ('Commerce test customer') RETURNING customer_id",
      );
      const customerId = customer.rows[0].customer_id as number;

      const plan = await client.query(
        `INSERT INTO public.membership_plans
           (name, duration_days, price, discount_percent)
         VALUES ('Test plan', 30, 100, 10)
         RETURNING plan_id`,
      );
      await client.query(
        `INSERT INTO public.memberships
           (customer_id, plan_id, starts_at, ends_at, status, price_paid)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days', 'active', 100)`,
        [customerId, plan.rows[0].plan_id],
      );

      const discount = await client.query(
        "SELECT public.commerce_active_membership_discount($1) AS discount",
        [customerId],
      );
      assert.equal(Number(discount.rows[0].discount), 10);

      const snack = await client.query(
        `INSERT INTO public.snack_items (name, unit_price, stock_quantity)
         VALUES ('Test chips', 30, 10)
         RETURNING snack_id`,
      );
      const snackId = snack.rows[0].snack_id as number;

      const order = await client.query(
        "INSERT INTO public.orders (customer_id) VALUES ($1) RETURNING order_id, discount_percent",
        [customerId],
      );
      const orderId = order.rows[0].order_id as number;
      assert.equal(Number(order.rows[0].discount_percent), 10);

      await client.query(
        `INSERT INTO public.order_items
           (order_id, snack_id, quantity, item_name_snapshot, unit_price, line_total)
         VALUES ($1, $2, 2, '', 0, 0)`,
        [orderId, snackId],
      );

      const pricedOrder = await client.query(
        "SELECT subtotal, discount_amount, total_amount FROM public.orders WHERE order_id = $1",
        [orderId],
      );
      assert.equal(Number(pricedOrder.rows[0].subtotal), 60);
      assert.equal(Number(pricedOrder.rows[0].discount_amount), 6);
      assert.equal(Number(pricedOrder.rows[0].total_amount), 54);

      const item = await client.query(
        "SELECT item_name_snapshot, unit_price, line_total FROM public.order_items WHERE order_id = $1",
        [orderId],
      );
      assert.equal(item.rows[0].item_name_snapshot, "Test chips");
      assert.equal(Number(item.rows[0].unit_price), 30);
      assert.equal(Number(item.rows[0].line_total), 60);

      await client.query(
        "UPDATE public.orders SET status = 'placed' WHERE order_id = $1",
        [orderId],
      );
      let stock = await client.query(
        "SELECT stock_quantity FROM public.snack_items WHERE snack_id = $1",
        [snackId],
      );
      assert.equal(stock.rows[0].stock_quantity, 8);

      await client.query(
        "UPDATE public.orders SET status = 'fulfilled' WHERE order_id = $1",
        [orderId],
      );
      stock = await client.query(
        "SELECT stock_quantity FROM public.snack_items WHERE snack_id = $1",
        [snackId],
      );
      assert.equal(stock.rows[0].stock_quantity, 8);

      const draft = await client.query(
        "INSERT INTO public.orders (customer_id) VALUES ($1) RETURNING order_id",
        [customerId],
      );
      const draftId = draft.rows[0].order_id as number;
      const draftItem = await client.query(
        `INSERT INTO public.order_items
           (order_id, snack_id, quantity, item_name_snapshot, unit_price, line_total)
         VALUES ($1, $2, 1, '', 0, 0)
         RETURNING order_item_id`,
        [draftId, snackId],
      );
      await client.query(
        "DELETE FROM public.order_items WHERE order_item_id = $1",
        [draftItem.rows[0].order_item_id],
      );
      const emptyDraft = await client.query(
        "SELECT subtotal, total_amount FROM public.orders WHERE order_id = $1",
        [draftId],
      );
      assert.equal(Number(emptyDraft.rows[0].subtotal), 0);
      assert.equal(Number(emptyDraft.rows[0].total_amount), 0);

      const fullOrder = await client.query(
        "INSERT INTO public.orders (customer_id) VALUES ($1) RETURNING order_id",
        [customerId],
      );
      const fullOrderId = fullOrder.rows[0].order_id as number;
      await client.query(
        `INSERT INTO public.order_items
           (order_id, snack_id, quantity, item_name_snapshot, unit_price, line_total)
         VALUES ($1, $2, 9, '', 0, 0)`,
        [fullOrderId, snackId],
      );
      await client.query("SAVEPOINT insufficient_stock");
      await assert.rejects(
        client.query("UPDATE public.orders SET status = 'placed' WHERE order_id = $1", [fullOrderId]),
        /Insufficient stock/,
      );
      await client.query("ROLLBACK TO SAVEPOINT insufficient_stock");
      const failedOrder = await client.query(
        "SELECT status FROM public.orders WHERE order_id = $1",
        [fullOrderId],
      );
      assert.equal(failedOrder.rows[0].status, "draft");

      const rls = await client.query(
        `SELECT relrowsecurity FROM pg_class
         WHERE oid = 'public.orders'::regclass`,
      );
      assert.equal(rls.rows[0].relrowsecurity, true);
      const grants = await client.query(
        "SELECT has_table_privilege('anon', 'public.orders', 'SELECT') AS can_select",
      );
      assert.equal(grants.rows[0].can_select, false);
      const unrelated = await client.query(
        "SELECT has_table_privilege('anon', 'public.unrelated_commerce_test_table', 'SELECT') AS can_select",
      );
      assert.equal(unrelated.rows[0].can_select, true);
    });
  },
);
