import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const planId = Number(body?.planId);
  const customerId = auth.profile.role === "customer"
    ? auth.profile.customerId
    : Number(body?.customerId);
  const paymentMethod = String(body?.paymentMethod ?? (auth.profile.role === "customer" ? "upi_demo" : "cash"));

  if (!Number.isInteger(planId) || planId < 1 ||
      !Number.isInteger(customerId) || !customerId || customerId < 1 ||
      !["cash", "upi_demo", "card_demo"].includes(paymentMethod)) {
    return NextResponse.json({ error: "Select a valid membership plan, customer and demo payment method." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query(
      "SELECT customer_id FROM public.customers WHERE customer_id = $1 FOR UPDATE",
      [customerId],
    );
    if (!customer.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    }

    await client.query(
      `UPDATE public.customer_memberships
       SET status = 'expired'
       WHERE customer_id = $1 AND status = 'active' AND end_at <= CURRENT_TIMESTAMP`,
      [customerId],
    );

    const existing = await client.query(
      "SELECT membership_id FROM public.customer_memberships WHERE customer_id = $1 AND status = 'active' LIMIT 1",
      [customerId],
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Customer already has an active membership." }, { status: 409 });
    }

    const created = await client.query(
      `INSERT INTO public.customer_memberships (customer_id, plan_id, payment_method)
       VALUES ($1, $2, $3)
       RETURNING membership_id, customer_id, plan_id, start_at, end_at,
                 status, price_paid, payment_method`,
      [customerId, planId, paymentMethod],
    );
    await client.query("COMMIT");
    return NextResponse.json(created.rows[0], { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = errorMessage(error);
    const status = message.includes("customer_memberships_one_active_per_customer") ? 409 : 500;
    return NextResponse.json(
      { error: status === 409 ? "Customer already has an active membership." : message },
      { status },
    );
  } finally {
    client.release();
  }
}
