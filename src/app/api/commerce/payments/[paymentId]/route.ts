import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ paymentId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const { paymentId: rawId } = await context.params;
  const paymentId = Number(rawId);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(paymentId) || paymentId < 1 || body?.status !== "refunded") {
    return NextResponse.json({ error: "Only a valid payment can be refunded." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT payment_id, order_id, amount, method, status, provider_reference, created_at
       FROM public.payments
       WHERE payment_id = $1
       FOR UPDATE`,
      [paymentId],
    );
    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    }

    if (existing.rows[0].status === "refunded") {
      await client.query("COMMIT");
      return NextResponse.json({ ...existing.rows[0], alreadyRefunded: true });
    }
    if (existing.rows[0].status !== "paid") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Only a paid payment can be refunded." }, { status: 409 });
    }

    const result = await client.query(
      `UPDATE public.payments
       SET status = 'refunded'
       WHERE payment_id = $1 AND status = 'paid'
       RETURNING payment_id, order_id, amount, method, status, provider_reference, created_at`,
      [paymentId],
    );
    await client.query("COMMIT");
    if (!result.rowCount) {
      return NextResponse.json({ error: "Payment state changed; refresh and retry." }, { status: 409 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  } finally {
    client.release();
  }
}
