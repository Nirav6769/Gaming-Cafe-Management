import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const category = String(body?.category ?? "").trim() || null;
  const description = String(body?.description ?? "").trim() || null;
  const unitPrice = Number(body?.unitPrice);
  const stockQuantity = Number(body?.stockQuantity);

  if (!name || name.length > 100 ||
      !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000 ||
      !Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1000000 ||
      (category && category.length > 80)) {
    return NextResponse.json({ error: "Enter a valid snack name, category, price and stock quantity." }, { status: 400 });
  }

  try {
    const result = await query(
      `INSERT INTO public.snack_items (name, category, description, unit_price, stock_quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING snack_id, name, category, description, unit_price, stock_quantity, is_active`,
      [name, category, description, unitPrice, stockQuantity],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json(
      { error: message.includes("snack_items_name_key") ? "A snack with that name already exists." : message },
      { status: message.includes("snack_items_name_key") ? 409 : 500 },
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

  const hasName = body?.name !== undefined;
  const hasCategory = body?.category !== undefined;
  const hasPrice = body?.unitPrice !== undefined;
  const hasStock = body?.stockQuantity !== undefined;
  const hasActive = body?.isActive !== undefined;
  const hasDescription = body?.description !== undefined;
  const name = hasName ? String(body.name).trim() : null;
  const category = hasCategory ? String(body.category ?? "").trim() || null : null;
  const unitPrice = hasPrice ? Number(body.unitPrice) : null;
  const stockQuantity = hasStock ? Number(body.stockQuantity) : null;
  const isActive = hasActive ? body.isActive : null;
  const description = hasDescription ? String(body.description ?? "").trim() || null : null;

  if (
    (hasName && (!name || name.length > 100)) ||
    (hasCategory && category && category.length > 80) ||
    (hasPrice && (!Number.isFinite(unitPrice) || unitPrice! < 0 || unitPrice! > 1000000)) ||
    (hasStock && (!Number.isInteger(stockQuantity) || stockQuantity! < 0 || stockQuantity! > 1000000)) ||
    (hasActive && typeof isActive !== "boolean")
  ) {
    return NextResponse.json({ error: "One or more snack fields are invalid." }, { status: 400 });
  }

  try {
    const result = await query(
      `UPDATE public.snack_items
       SET name = COALESCE($1, name),
           category = CASE WHEN $2::BOOLEAN THEN $3 ELSE category END,
           description = CASE WHEN $4::BOOLEAN THEN $5 ELSE description END,
           unit_price = COALESCE($6, unit_price),
           stock_quantity = COALESCE($7, stock_quantity),
           is_active = COALESCE($8, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE snack_id = $9
       RETURNING snack_id, name, category, description, unit_price, stock_quantity, is_active`,
      [name, hasCategory, category, hasDescription, description, unitPrice, stockQuantity, isActive, snackId],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Snack item not found." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  }
}
