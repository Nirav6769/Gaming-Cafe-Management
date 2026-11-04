import { NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const customerId = auth.profile.role === "customer"
    ? auth.profile.customerId
    : null;
  const canManage = auth.profile.role !== "customer";

  try {
    const [plans, snacks, memberships, orders, customers] = await Promise.all([
      query(
        `SELECT plan_id, name, description, duration_days, price,
                discount_percent, is_active
         FROM public.membership_plans
         WHERE ($1::BOOLEAN = TRUE OR is_active = TRUE)
         ORDER BY price, duration_days`,
        [canManage],
      ),
      query(
        `SELECT snack_id, name, category, description, unit_price,
                stock_quantity, is_active
         FROM public.snack_items
         WHERE ($1::BOOLEAN = TRUE OR is_active = TRUE)
         ORDER BY name`,
        [canManage],
      ),
      query(
        `SELECT cm.membership_id, cm.customer_id, c.name AS customer_name,
                cm.plan_id, mp.name AS plan_name, mp.discount_percent,
                cm.start_at, cm.end_at, cm.status, cm.price_paid,
                cm.payment_method
         FROM public.customer_memberships cm
         JOIN public.customers c ON c.customer_id = cm.customer_id
         JOIN public.membership_plans mp ON mp.plan_id = cm.plan_id
         WHERE ($1::INTEGER IS NULL OR cm.customer_id = $1)
         ORDER BY cm.created_at DESC
         LIMIT 100`,
        [customerId],
      ),
      query(
        `SELECT o.order_id, o.customer_id, c.name AS customer_name,
                o.status, o.subtotal, o.discount_percent_snapshot,
                o.discount_amount, o.total_amount, o.created_at,
                o.inventory_deducted_at,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'order_item_id', oi.order_item_id,
                    'snack_id', oi.snack_id,
                    'name', oi.item_name_snapshot,
                    'quantity', oi.quantity,
                    'unit_price_at_purchase', oi.unit_price_at_purchase,
                    'line_total', oi.line_total
                  ) ORDER BY oi.order_item_id)
                  FROM public.order_items oi
                  WHERE oi.order_id = o.order_id
                ), '[]'::JSON) AS items,
                (
                  SELECT json_build_object(
                    'payment_id', p.payment_id,
                    'amount', p.amount,
                    'method', p.method,
                    'status', p.status,
                    'provider_reference', p.provider_reference,
                    'created_at', p.created_at
                  )
                  FROM public.payments p
                  WHERE p.order_id = o.order_id
                  LIMIT 1
                ) AS payment
         FROM public.orders o
         JOIN public.customers c ON c.customer_id = o.customer_id
         WHERE ($1::INTEGER IS NULL OR o.customer_id = $1)
         ORDER BY o.created_at DESC
         LIMIT 100`,
        [customerId],
      ),
      query(
        `SELECT customer_id, name, email, phone, join_date, updated_at
         FROM public.customers
         WHERE ($1::BOOLEAN = TRUE OR customer_id = $2)
         ORDER BY name
         LIMIT 500`,
        [canManage, customerId],
      ),
    ]);

    return NextResponse.json({
      role: auth.profile.role,
      customerId: auth.profile.customerId,
      plans: plans.rows,
      snacks: snacks.rows,
      memberships: memberships.rows,
      orders: orders.rows,
      customers: customers.rows,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
