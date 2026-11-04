import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const { orderId: rawOrderId } = await context.params;
  const orderId = Number(rawOrderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const nextStatus = String(body?.status ?? "");
  if (!["placed", "fulfilled", "cancelled"].includes(nextStatus)) {
    return NextResponse.json({ error: "Unsupported order status." }, { status: 400 });
  }

  const customerId = auth.profile.role === "customer"
    ? auth.profile.customerId
    : null;
  if (auth.profile.role === "customer" && !["placed", "cancelled"].includes(nextStatus)) {
    return NextResponse.json({ error: "Customers cannot perform this order action." }, { status: 403 });
  }

  try {
    const result = await query(
      `UPDATE public.orders
       SET status = $1
       WHERE order_id = $2
         AND ($3::INTEGER IS NULL OR customer_id = $3)
       RETURNING order_id, customer_id, status, subtotal, discount_percent,
                 discount_amount, total_amount, placed_at, fulfilled_at`,
      [nextStatus, orderId, customerId],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    const message = errorMessage(error);
    const isInventory = message.toLowerCase().includes("insufficient stock");
    return NextResponse.json(
      { error: isInventory ? message : message },
      { status: isInventory ? 409 : 409 },
    );
  }
}
