import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const { orderId: rawOrderId } = await context.params;
  const orderId = Number(rawOrderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const method = String(body?.paymentMethod ?? "demo");
  if (!["cash", "demo"].includes(method)) {
    return NextResponse.json({ error: "Choose cash or demo payment." }, { status: 400 });
  }

  if (auth.profile.role === "customer" && method !== "demo") {
    return NextResponse.json({ error: "Customers can only use the demo payment option." }, { status: 403 });
  }

  const customerId = auth.profile.role === "customer"
    ? auth.profile.customerId
    : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(
      `SELECT order_id, customer_id, status, total_amount
       FROM public.orders
       WHERE order_id = $1
         AND ($2::INTEGER IS NULL OR customer_id = $2)
       FOR UPDATE`,
      [orderId, customerId],
    );
    if (!order.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    if (!["placed", "fulfilled"].includes(order.rows[0].status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Place the order before recording payment." }, { status: 409 });
    }

    const existing = await client.query(
      "SELECT payment_id FROM public.payments WHERE order_id = $1 AND payment_status = 'succeeded'",
      [orderId],
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This order already has a successful payment." }, { status: 409 });
    }

    const payment = await client.query(
      `INSERT INTO public.payments
         (order_id, amount, payment_method, payment_status, transaction_reference, note)
       VALUES ($1, $2, $3, 'succeeded', $4, $5)
       RETURNING payment_id, order_id, amount, payment_method, payment_status,
                 transaction_reference, created_at`,
      [
        orderId,
        order.rows[0].total_amount,
        method,
        `DEMO-${randomUUID()}`,
        "Demo payment record only. No external gateway or card data was used.",
      ],
    );

    await client.query("COMMIT");
    return NextResponse.json(payment.rows[0], { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = errorMessage(error);
    return NextResponse.json(
      { error: message.includes("payments_one_success_per_order") ? "This order already has a successful payment." : message },
      { status: 409 },
    );
  } finally {
    client.release();
  }
}
