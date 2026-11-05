import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ orderId: string; itemId: string }> };

async function getScopedIds(
  authCustomerId: number | null,
  rawOrderId: string,
  rawItemId: string,
) {
  const orderId = Number(rawOrderId);
  const itemId = Number(rawItemId);
  if (!Number.isInteger(orderId) || orderId < 1 || !Number.isInteger(itemId) || itemId < 1) {
    return null;
  }
  return { orderId, itemId, customerId: authCustomerId };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const params = await context.params;
  const ids = await getScopedIds(
    auth.profile.role === "customer" ? auth.profile.customerId : null,
    params.orderId,
    params.itemId,
  );
  if (!ids) return NextResponse.json({ error: "Invalid order or item ID." }, { status: 400 });

  const body = await request.json().catch(() => null);
  const quantity = Number(body?.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return NextResponse.json({ error: "Quantity must be a whole number between 1 and 999." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE public.order_items oi
       SET quantity = $1
       FROM public.orders o
       WHERE oi.order_item_id = $2 AND oi.order_id = $3
         AND o.order_id = oi.order_id AND o.status = 'pending'
         AND ($4::INTEGER IS NULL OR o.customer_id = $4)
       RETURNING oi.order_item_id, oi.order_id, oi.quantity,
                 oi.item_name_snapshot, oi.unit_price_at_purchase, oi.line_total`,
      [quantity, ids.itemId, ids.orderId, ids.customerId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Pending order item not found." }, { status: 404 });
    }
    await client.query("COMMIT");
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  } finally {
    client.release();
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const params = await context.params;
  const ids = await getScopedIds(
    auth.profile.role === "customer" ? auth.profile.customerId : null,
    params.orderId,
    params.itemId,
  );
  if (!ids) return NextResponse.json({ error: "Invalid order or item ID." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `DELETE FROM public.order_items oi
       USING public.orders o
       WHERE oi.order_item_id = $1 AND oi.order_id = $2
         AND o.order_id = oi.order_id AND o.status = 'pending'
         AND ($3::INTEGER IS NULL OR o.customer_id = $3)
       RETURNING oi.order_item_id`,
      [ids.itemId, ids.orderId, ids.customerId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Pending order item not found." }, { status: 404 });
    }
    await client.query("COMMIT");
    return NextResponse.json({ deleted: true, orderItemId: ids.itemId });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  } finally {
    client.release();
  }
}
