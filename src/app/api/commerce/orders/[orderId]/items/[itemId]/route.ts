import { NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderId: string; itemId: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const { orderId: rawOrderId, itemId: rawItemId } = await context.params;
  const orderId = Number(rawOrderId);
  const itemId = Number(rawItemId);
  if (!Number.isInteger(orderId) || orderId < 1 || !Number.isInteger(itemId) || itemId < 1) {
    return NextResponse.json({ error: "Invalid order or item ID." }, { status: 400 });
  }

  const customerId = auth.profile.role === "customer"
    ? auth.profile.customerId
    : null;

  try {
    const result = await query(
      `DELETE FROM public.order_items oi
       USING public.orders o
       WHERE oi.order_item_id = $1
         AND oi.order_id = $2
         AND o.order_id = oi.order_id
         AND o.status = 'draft'
         AND ($3::INTEGER IS NULL OR o.customer_id = $3)
       RETURNING oi.order_item_id`,
      [itemId, orderId, customerId],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Draft order item not found or no longer editable." },
        { status: 404 },
      );
    }
    return NextResponse.json({ deleted: true, orderItemId: itemId });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
