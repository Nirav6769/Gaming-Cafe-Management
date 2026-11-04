import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const orderId = Number(body?.orderId);
  const method = String(body?.method ?? "cash");
  if (!Number.isInteger(orderId) || orderId < 1 ||
      !["cash", "upi_demo", "card_demo"].includes(method)) {
    return NextResponse.json({ error: "Select a valid order and payment method." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(
      `SELECT order_id, status, total_amount
       FROM public.orders WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );
    if (!order.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    if (order.rows[0].status !== "pending") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Only a pending order can be paid." }, { status: 409 });
    }

    const payment = await client.query(
      `INSERT INTO public.payments
         (order_id, amount, method, status, provider_reference, note)
       VALUES ($1, $2, $3, 'pending', $4, $5)
       RETURNING payment_id`,
      [
        orderId,
        order.rows[0].total_amount,
        method,
        method === "cash" ? null : `DEMO-${randomUUID()}`,
        method === "cash" ? "Cash recorded by authorised café staff." : "Demo payment only. No external gateway or credentials were used.",
      ],
    );

    const paid = await client.query(
      `UPDATE public.payments
       SET status = 'paid'
       WHERE payment_id = $1
       RETURNING payment_id, order_id, amount, method, status, provider_reference, created_at`,
      [payment.rows[0].payment_id],
    );

    await client.query("COMMIT");
    return NextResponse.json(paid.rows[0], { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = errorMessage(error);
    const stockFailure = message.toLowerCase().includes("insufficient stock");
    return NextResponse.json(
      { error: message },
      { status: stockFailure ? 409 : 409 },
    );
  } finally {
    client.release();
  }
}
