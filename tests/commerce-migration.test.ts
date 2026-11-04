import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { databaseTestSkip, withRollback } from "./helpers/db";

async function expectDbFailure(
  client: PoolClient,
  sql: string,
  values: unknown[],
  pattern: RegExp,
) {
  await client.query("SAVEPOINT expected_failure");
  await assert.rejects(client.query(sql, values), pattern);
  await client.query("ROLLBACK TO SAVEPOINT expected_failure");
  await client.query("RELEASE SAVEPOINT expected_failure");
}

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
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  phone VARCHAR(15),
  join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.staff (
  staff_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);
CREATE TABLE public.user_profiles (
  auth_user_id UUID PRIMARY KEY
);
CREATE TABLE public.unrelated_commerce_test_table (id INTEGER PRIMARY KEY);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
`;

test(
  "commerce migration enforces membership, price, stock, payment and RLS invariants",
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
        `INSERT INTO public.customers (name, email)
         VALUES ('Commerce test customer', 'commerce-test@example.com')
         RETURNING customer_id, updated_at`,
      );
      const customerId = customer.rows[0].customer_id as number;
      await client.query(
        "UPDATE public.customers SET updated_at = '2000-01-01' WHERE customer_id = $1",
        [customerId],
      );
      const touchedCustomer = await client.query(
        "SELECT updated_at FROM public.customers WHERE customer_id = $1",
        [customerId],
      );
      assert.ok(new Date(touchedCustomer.rows[0].updated_at).getTime() > new Date("2000-01-01").getTime());

      const plan = await client.query(
        `INSERT INTO public.membership_plans
           (name, duration_days, price, discount_percent)
         VALUES ('Test plan', 30, 100, 15)
         RETURNING plan_id`,
      );
      const planId = Number(plan.rows[0].plan_id);

      const membership = await client.query(
        `INSERT INTO public.customer_memberships
           (customer_id, plan_id, price_paid, payment_method)
         VALUES ($1, $2, 0, 'upi_demo')
         RETURNING membership_id, price_paid, start_at, end_at, status`,
        [customerId, planId],
      );
      const membershipId = Number(membership.rows[0].membership_id);
      assert.equal(Number(membership.rows[0].price_paid), 100);
      assert.equal(membership.rows[0].status, "active");
      assert.ok(new Date(membership.rows[0].end_at).getTime() > new Date(membership.rows[0].start_at).getTime());

      let discount = await client.query(
        "SELECT public.commerce_get_customer_discount_percent($1) AS discount",
        [customerId],
      );
      assert.equal(Number(discount.rows[0].discount), 15);

      await client.query(
        `UPDATE public.customer_memberships
         SET start_at = CURRENT_TIMESTAMP - INTERVAL '31 days',
             end_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
         WHERE membership_id = $1`,
        [membershipId],
      );
      discount = await client.query(
        "SELECT public.commerce_get_customer_discount_percent($1) AS discount",
        [customerId],
      );
      assert.equal(Number(discount.rows[0].discount), 0);

      await client.query(
        "UPDATE public.customer_memberships SET status = 'cancelled' WHERE membership_id = $1",
        [membershipId],
      );
      await client.query(
        `INSERT INTO public.customer_memberships (customer_id, plan_id, payment_method)
         VALUES ($1, $2, 'card_demo')`,
        [customerId, planId],
      );
      discount = await client.query(
        "SELECT public.commerce_get_customer_discount_percent($1) AS discount",
        [customerId],
      );
      assert.equal(Number(discount.rows[0].discount), 15);

      const chips = await client.query(
        `INSERT INTO public.snack_items (name, unit_price, stock_quantity)
         VALUES ('Test chips', 30, 10)
         RETURNING snack_id`,
      );
      const chipsId = Number(chips.rows[0].snack_id);
      const soda = await client.query(
        `INSERT INTO public.snack_items (name, unit_price, stock_quantity)
         VALUES ('Test soda', 25, 1)
         RETURNING snack_id`,
      );
      const sodaId = Number(soda.rows[0].snack_id);

      await expectDbFailure(
        client,
        `INSERT INTO public.snack_items (name, unit_price, stock_quantity)
         VALUES ('Negative stock', 2, -1)`,
        [],
        /check constraint/i,
      );
      await expectDbFailure(
        client,
        `INSERT INTO public.snack_items (name, unit_price, stock_quantity)
         VALUES ('Negative price', -2, 1)`,
        [],
        /check constraint/i,
      );

      const draft = await client.query(
        "INSERT INTO public.orders (customer_id) VALUES ($1) RETURNING order_id, discount_percent_snapshot",
        [customerId],
      );
      const draftId = Number(draft.rows[0].order_id);
      assert.equal(Number(draft.rows[0].discount_percent_snapshot), 15);

      await client.query(
        `INSERT INTO public.order_items
           (order_id, snack_id, item_name_snapshot, quantity, unit_price_at_purchase, line_total)
         VALUES ($1, $2, '', 2, 0, 0)`,
        [draftId, chipsId],
      );

      let totals = await client.query(
        "SELECT subtotal, discount_amount, total_amount FROM public.orders WHERE order_id = $1",
        [draftId],
      );
      assert.equal(Number(totals.rows[0].subtotal), 60);
      assert.equal(Number(totals.rows[0].discount_amount), 9);
      assert.equal(Number(totals.rows[0].total_amount), 51);

      await client.query(
        "UPDATE public.snack_items SET unit_price = 40 WHERE snack_id = $1",
        [chipsId],
      );
      await client.query(
        "UPDATE public.order_items SET quantity = 3 WHERE order_id = $1 AND snack_id = $2",
        [draftId, chipsId],
      );
      const item = await client.query(
        "SELECT item_name_snapshot, quantity, unit_price_at_purchase, line_total FROM public.order_items WHERE order_id = $1 AND snack_id = $2",
        [draftId, chipsId],
      );
      assert.equal(item.rows[0].item_name_snapshot, "Test chips");
      assert.equal(Number(item.rows[0].quantity), 3);
      assert.equal(Number(item.rows[0].unit_price_at_purchase), 30);
      assert.equal(Number(item.rows[0].line_total), 90);

      const secondItem = await client.query(
        `INSERT INTO public.order_items
           (order_id, snack_id, item_name_snapshot, quantity, unit_price_at_purchase, line_total)
         VALUES ($1, $2, '', 1, 0, 0)
         RETURNING order_item_id`,
        [draftId, sodaId],
      );
      totals = await client.query(
        "SELECT subtotal, discount_amount, total_amount FROM public.orders WHERE order_id = $1",
        [draftId],
      );
      assert.equal(Number(totals.rows[0].subtotal), 115);
      assert.equal(Number(totals.rows[0].discount_amount), 17.25);
      assert.equal(Number(totals.rows[0].total_amount), 97.75);

      await client.query(
        "DELETE FROM public.order_items WHERE order_item_id = $1",
        [secondItem.rows[0].order_item_id],
      );
      totals = await client.query(
        "SELECT subtotal, discount_amount, total_amount FROM public.orders WHERE order_id = $1",
        [draftId],
      );
      assert.equal(Number(totals.rows[0].subtotal), 90);
      assert.equal(Number(totals.rows[0].discount_amount), 13.5);
      assert.equal(Number(totals.rows[0].total_amount), 76.5);

      const emptyOrder = await client.query(
        "INSERT INTO public.orders (customer_id) VALUES ($1) RETURNING order_id",
        [customerId],
      );
      const emptyOrderId = Number(emptyOrder.rows[0].order_id);
      const emptyPayment = await client.query(
        `INSERT INTO public.payments (order_id, amount, method, status)
         VALUES ($1, 0, 'cash', 'pending') RETURNING payment_id`,
        [emptyOrderId],
      );
      await expectDbFailure(
        client,
        "UPDATE public.payments SET status = 'paid' WHERE payment_id = $1",
        [emptyPayment.rows[0].payment_id],
        /empty order/i,
      );

      const insufficient = await client.query(
        "INSERT INTO public.orders (customer_id) VALUES ($1) RETURNING order_id",
        [customerId],
      );
      const insufficientId = Number(insufficient.rows[0].order_id);
      await client.query(
        `INSERT INTO public.order_items
           (order_id, snack_id, item_name_snapshot, quantity, unit_price_at_purchase, line_total)
         VALUES ($1, $2, '', 2, 0, 0), ($1, $3, '', 2, 0, 0)`,
        [insufficientId, chipsId, sodaId],
      );
      const insufficientTotal = await client.query(
        "SELECT total_amount FROM public.orders WHERE order_id = $1",
        [insufficientId],
      );
      const failedPayment = await client.query(
        `INSERT INTO public.payments (order_id, amount, method, status)
         VALUES ($1, $2, 'cash', 'pending') RETURNING payment_id`,
        [insufficientId, insufficientTotal.rows[0].total_amount],
      );
      await expectDbFailure(
        client,
        "UPDATE public.payments SET status = 'paid' WHERE payment_id = $1",
        [failedPayment.rows[0].payment_id],
        /insufficient stock/i,
      );

      let stock = await client.query(
        "SELECT stock_quantity FROM public.snack_items WHERE snack_id = $1",
        [chipsId],
      );
      assert.equal(Number(stock.rows[0].stock_quantity), 10);
      stock = await client.query(
        "SELECT stock_quantity FROM public.snack_items WHERE snack_id = $1",
        [sodaId],
      );
      assert.equal(Number(stock.rows[0].stock_quantity), 1);
      const stillPending = await client.query(
        `SELECT o.status AS order_status, p.status AS payment_status
         FROM public.orders o JOIN public.payments p ON p.order_id = o.order_id
         WHERE o.order_id = $1`,
        [insufficientId],
      );
      assert.equal(stillPending.rows[0].order_status, "pending");
      assert.equal(stillPending.rows[0].payment_status, "pending");

      const successful = await client.query(
        "INSERT INTO public.orders (customer_id) VALUES ($1) RETURNING order_id",
        [customerId],
      );
      const successfulId = Number(successful.rows[0].order_id);
      await client.query(
        `INSERT INTO public.order_items
           (order_id, snack_id, item_name_snapshot, quantity, unit_price_at_purchase, line_total)
         VALUES ($1, $2, '', 2, 0, 0), ($1, $3, '', 1, 0, 0)`,
        [successfulId, chipsId, sodaId],
      );
      const successfulTotal = await client.query(
        "SELECT total_amount FROM public.orders WHERE order_id = $1",
        [successfulId],
      );
      const successfulPayment = await client.query(
        `INSERT INTO public.payments (order_id, amount, method, status)
         VALUES ($1, $2, 'upi_demo', 'pending') RETURNING payment_id`,
        [successfulId, successfulTotal.rows[0].total_amount],
      );
      await client.query(
        "UPDATE public.payments SET status = 'paid' WHERE payment_id = $1",
        [successfulPayment.rows[0].payment_id],
      );

      let state = await client.query(
        `SELECT o.status, o.inventory_deducted_at, p.status AS payment_status
         FROM public.orders o JOIN public.payments p ON p.order_id = o.order_id
         WHERE o.order_id = $1`,
        [successfulId],
      );
      assert.equal(state.rows[0].status, "paid");
      assert.ok(state.rows[0].inventory_deducted_at);
      assert.equal(state.rows[0].payment_status, "paid");

      stock = await client.query("SELECT stock_quantity FROM public.snack_items WHERE snack_id = $1", [chipsId]);
      assert.equal(Number(stock.rows[0].stock_quantity), 8);
      stock = await client.query("SELECT stock_quantity FROM public.snack_items WHERE snack_id = $1", [sodaId]);
      assert.equal(Number(stock.rows[0].stock_quantity), 0);

      await client.query(
        "UPDATE public.payments SET status = 'paid' WHERE payment_id = $1",
        [successfulPayment.rows[0].payment_id],
      );
      stock = await client.query("SELECT stock_quantity FROM public.snack_items WHERE snack_id = $1", [chipsId]);
      assert.equal(Number(stock.rows[0].stock_quantity), 8);

      await expectDbFailure(
        client,
        "UPDATE public.order_items SET quantity = 3 WHERE order_id = $1",
        [successfulId],
        /pending/i,
      );
      await expectDbFailure(
        client,
        "DELETE FROM public.order_items WHERE order_id = $1",
        [successfulId],
        /pending/i,
      );
      await expectDbFailure(
        client,
        "DELETE FROM public.orders WHERE order_id = $1",
        [successfulId],
        /foreign key/i,
      );

      await client.query(
        "UPDATE public.payments SET status = 'refunded' WHERE payment_id = $1",
        [successfulPayment.rows[0].payment_id],
      );
      await client.query(
        "UPDATE public.payments SET status = 'refunded' WHERE payment_id = $1",
        [successfulPayment.rows[0].payment_id],
      );
      state = await client.query(
        `SELECT o.status, p.status AS payment_status
         FROM public.orders o JOIN public.payments p ON p.order_id = o.order_id
         WHERE o.order_id = $1`,
        [successfulId],
      );
      assert.equal(state.rows[0].status, "refunded");
      assert.equal(state.rows[0].payment_status, "refunded");
      stock = await client.query("SELECT stock_quantity FROM public.snack_items WHERE snack_id = $1", [chipsId]);
      assert.equal(Number(stock.rows[0].stock_quantity), 8);

      const directPaid = await client.query(
        "INSERT INTO public.orders (customer_id) VALUES ($1) RETURNING order_id",
        [customerId],
      );
      await expectDbFailure(
        client,
        "UPDATE public.orders SET status = 'paid' WHERE order_id = $1",
        [directPaid.rows[0].order_id],
        /matching payment/i,
      );

      const commerceTables = [
        "membership_plans", "customer_memberships", "snack_items",
        "orders", "order_items", "payments",
      ];
      for (const table of commerceTables) {
        const rls = await client.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass",
          [`public.${table}`],
        );
        assert.equal(rls.rows[0].relrowsecurity, true, `${table} should have RLS enabled`);
        const grants = await client.query(
          "SELECT has_table_privilege('anon', $1, 'SELECT') AS anon_select, has_table_privilege('authenticated', $1, 'SELECT') AS auth_select",
          [`public.${table}`],
        );
        assert.equal(grants.rows[0].anon_select, false, `${table} should not be selectable by anon`);
        assert.equal(grants.rows[0].auth_select, false, `${table} should not be selectable by authenticated`);
      }

      const unrelated = await client.query(
        "SELECT has_table_privilege('anon', 'public.unrelated_commerce_test_table', 'SELECT') AS can_select",
      );
      assert.equal(unrelated.rows[0].can_select, true);
      const functionAccess = await client.query(
        "SELECT has_function_privilege('anon', 'public.commerce_get_customer_discount_percent(integer)', 'EXECUTE') AS can_execute",
      );
      assert.equal(functionAccess.rows[0].can_execute, false);
    });
  },
);
