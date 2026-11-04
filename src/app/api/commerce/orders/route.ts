import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RequestedItem = { snackId: number; quantity: number };

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length < 1 || rawItems.length > 25) {
    return NextResponse.json({ error: "Add between 1 and 25 snack items." }, { status: 400 });
  }

  const itemMap = new Map<number, number>();
  for (const raw of rawItems) {
    const snackId = Number(raw?.snackId);
    const quantity = Number(raw?.quantity);
    if (
      !Number.isInteger(snackId) || snackId < 1 ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 999
    ) {
      return NextResponse.json({ error: "Each item needs a valid snack and quantity (1–999)." }, { status: 400 });
    }
    itemMap.set(snackId, (itemMap.get(snackId) ?? 0) + quantity);
  }
  if ([...itemMap.values()].some((quantity) => quantity > 999)) {
    return NextResponse.json({ error: "Combined snack quantity cannot exceed 999." }, { status: 400 });
  }

  const customerId = auth.profile.role === "customer"
    ? auth.profile.customerId
    : Number(body?.customerId);
  if (!Number.isInteger(customerId) || !customerId || customerId < 1) {
    return NextResponse.json({ error: "Select a valid customer." }, { status: 400 });
  }

  const notes = String(body?.notes ?? "").trim() || null;
  if (notes && notes.length > 500) {
    return NextResponse.json({ error: "Order notes cannot exceed 500 characters." }, { status: 400 });
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

    const order = await client.query(
      `INSERT INTO public.orders (customer_id, created_by_staff_id, notes)
       VALUES ($1, $2, $3)
       RETURNING order_id, customer_id, status, discount_percent, subtotal, discount_amount, total_amount`,
      [customerId, auth.profile.role === "customer" ? null : auth.profile.staffId, notes],
    );
    const orderId = order.rows[0].order_id as number;

    for (const [snackId, quantity] of itemMap) {
      await client.query(
        `INSERT INTO public.order_items (order_id, snack_id, quantity, item_name_snapshot, unit_price, line_total)
         VALUES ($1, $2, $3, '', 0, 0)`,
        [orderId, snackId, quantity],
      );
    }

    const result = await client.query(
      `SELECT order_id, customer_id, status, subtotal, discount_percent, discount_amount, total_amount
       FROM public.orders WHERE order_id = $1`,
      [orderId],
    );
    await client.query("COMMIT");
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  } finally {
    client.release();
  }
}
