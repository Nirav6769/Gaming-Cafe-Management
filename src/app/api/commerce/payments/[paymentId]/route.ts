import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
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

  try {
    const existing = await query(
      "SELECT payment_id, status FROM public.payments WHERE payment_id = $1",
      [paymentId],
    );
    if (!existing.rowCount) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    if (existing.rows[0].status === "refunded") {
      return NextResponse.json({ paymentId, status: "refunded", alreadyRefunded: true });
    }
    if (existing.rows[0].status !== "paid") {
      return NextResponse.json({ error: "Only a paid payment can be refunded." }, { status: 409 });
    }

    const result = await query(
      `UPDATE public.payments
       SET status = 'refunded'
       WHERE payment_id = $1 AND status = 'paid'
       RETURNING payment_id, order_id, amount, method, status, provider_reference, created_at`,
      [paymentId],
    );
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  }
}
