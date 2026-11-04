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
  if (!Number.isInteger(planId) || planId < 1 || !Number.isInteger(customerId) || !customerId || customerId < 1) {
    return NextResponse.json({ error: "Select a valid membership plan and customer." }, { status: 400 });
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

    const plan = await client.query(
      `SELECT plan_id, price, duration_days
       FROM public.membership_plans
       WHERE plan_id = $1 AND is_active = TRUE
       FOR SHARE`,
      [planId],
    );
    if (!plan.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Membership plan is unavailable." }, { status: 404 });
    }

    await client.query(
      `UPDATE public.memberships
       SET status = 'expired'
       WHERE customer_id = $1
         AND status = 'active'
         AND ends_at <= CURRENT_TIMESTAMP`,
      [customerId],
    );

    const created = await client.query(
      `INSERT INTO public.memberships
         (customer_id, plan_id, starts_at, ends_at, status, price_paid, created_by_staff_id)
       VALUES (
         $1, $2, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + ($3::INTEGER * INTERVAL '1 day'),
         'active', $4, $5
       )
       RETURNING membership_id, customer_id, plan_id, starts_at, ends_at, status, price_paid`,
      [customerId, planId, plan.rows[0].duration_days, plan.rows[0].price,
        auth.profile.role === "customer" ? null : auth.profile.staffId],
    );

    await client.query("COMMIT");
    return NextResponse.json(created.rows[0], { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = errorMessage(error);
    const status = message.includes("memberships_one_active_per_customer") ? 409 : 500;
    return NextResponse.json(
      { error: status === 409 ? "Customer already has an active membership." : message },
      { status },
    );
  } finally {
    client.release();
  }
}
