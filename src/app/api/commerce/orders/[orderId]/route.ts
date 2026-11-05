import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ orderId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const { orderId: rawId } = await context.params;
  const orderId = Number(rawId);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(orderId) || orderId < 1 || body?.status !== "cancelled") {
    return NextResponse.json({ error: "Only cancellation of a valid pending order is supported." }, { status: 400 });
  }

  const customerId = auth.profile.role === "customer" ? auth.profile.customerId : null;
  try {
    const result = await query(
      `UPDATE public.orders
       SET status = 'cancelled'
       WHERE order_id = $1 AND status = 'pending'
         AND ($2::INTEGER IS NULL OR customer_id = $2)
       RETURNING order_id, customer_id, status`,
      [orderId, customerId],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Pending order not found." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  }
}
