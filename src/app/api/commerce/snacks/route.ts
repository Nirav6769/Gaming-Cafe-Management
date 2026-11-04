import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const description = String(body?.description ?? "").trim() || null;
  const unitPrice = Number(body?.unitPrice);
  const stockQuantity = Number(body?.stockQuantity);

  if (
    !name || name.length > 100 ||
    !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000 ||
    !Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1000000
  ) {
    return NextResponse.json({ error: "Enter a valid snack name, price and stock quantity." }, { status: 400 });
  }

  try {
    const result = await query(
      `INSERT INTO public.snack_items (name, description, unit_price, stock_quantity)
       VALUES ($1, $2, $3, $4)
       RETURNING snack_id, name, description, unit_price, stock_quantity, is_active`,
      [name, description, unitPrice, stockQuantity],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json(
      { error: message.includes("snack_items_name_key") ? "A snack with that name already exists." : message },
      { status: 409 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const snackId = Number(body?.snackId);
  if (!Number.isInteger(snackId) || snackId < 1) {
    return NextResponse.json({ error: "A valid snack ID is required." }, { status: 400 });
  }

  const hasPrice = body?.unitPrice !== undefined;
  const hasStock = body?.stockQuantity !== undefined;
  const hasActive = body?.isActive !== undefined;
  const hasDescription = body?.description !== undefined;

  const unitPrice = hasPrice ? Number(body.unitPrice) : null;
  const stockQuantity = hasStock ? Number(body.stockQuantity) : null;
  const isActive = hasActive ? body.isActive : null;
  const description = hasDescription
    ? (String(body.description ?? "").trim() || null)
    : null;

  if (
    (hasPrice && (!Number.isFinite(unitPrice) || unitPrice! < 0 || unitPrice! > 1000000)) ||
    (hasStock && (!Number.isInteger(stockQuantity) || stockQuantity! < 0 || stockQuantity! > 1000000)) ||
    (hasActive && typeof isActive !== "boolean")
  ) {
    return NextResponse.json({ error: "One or more snack fields are invalid." }, { status: 400 });
  }

  try {
    const result = await query(
      `UPDATE public.snack_items
       SET unit_price = COALESCE($1, unit_price),
           stock_quantity = COALESCE($2, stock_quantity),
           is_active = COALESCE($3, is_active),
           description = CASE WHEN $4::BOOLEAN THEN $5 ELSE description END,
           updated_at = CURRENT_TIMESTAMP
       WHERE snack_id = $6
       RETURNING snack_id, name, description, unit_price, stock_quantity, is_active`,
      [unitPrice, stockQuantity, isActive, hasDescription, description, snackId],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Snack item not found." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
