import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const description = String(body?.description ?? "").trim() || null;
  const durationDays = Number(body?.durationDays);
  const price = Number(body?.price);
  const discountPercent = Number(body?.discountPercent);

  if (!name || name.length > 80 ||
      !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650 ||
      !Number.isFinite(price) || price < 0 || price > 1000000 ||
      !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return NextResponse.json({ error: "Enter a valid plan name, duration, price and discount." }, { status: 400 });
  }

  try {
    const result = await query(
      `INSERT INTO public.membership_plans
         (name, description, duration_days, price, discount_percent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING plan_id, name, description, duration_days, price, discount_percent, is_active`,
      [name, description, durationDays, price, discountPercent],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json(
      { error: message.includes("membership_plans_name_key") ? "A plan with that name already exists." : message },
      { status: message.includes("membership_plans_name_key") ? 409 : 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const planId = Number(body?.planId);
  if (!Number.isInteger(planId) || planId < 1) {
    return NextResponse.json({ error: "A valid plan ID is required." }, { status: 400 });
  }

  const hasName = body?.name !== undefined;
  const hasDescription = body?.description !== undefined;
  const hasDuration = body?.durationDays !== undefined;
  const hasPrice = body?.price !== undefined;
  const hasDiscount = body?.discountPercent !== undefined;
  const hasActive = body?.isActive !== undefined;
  const name = hasName ? String(body.name).trim() : null;
  const description = hasDescription ? String(body.description ?? "").trim() || null : null;
  const duration = hasDuration ? Number(body.durationDays) : null;
  const price = hasPrice ? Number(body.price) : null;
  const discount = hasDiscount ? Number(body.discountPercent) : null;
  const active = hasActive ? body.isActive : null;

  if (
    (hasName && (!name || name.length > 80)) ||
    (hasDuration && (!Number.isInteger(duration) || duration! < 1 || duration! > 3650)) ||
    (hasPrice && (!Number.isFinite(price) || price! < 0 || price! > 1000000)) ||
    (hasDiscount && (!Number.isFinite(discount) || discount! < 0 || discount! > 100)) ||
    (hasActive && typeof active !== "boolean")
  ) {
    return NextResponse.json({ error: "One or more plan fields are invalid." }, { status: 400 });
  }

  try {
    const result = await query(
      `UPDATE public.membership_plans
       SET name = COALESCE($1, name),
           description = CASE WHEN $2::BOOLEAN THEN $3 ELSE description END,
           duration_days = COALESCE($4, duration_days),
           price = COALESCE($5, price),
           discount_percent = COALESCE($6, discount_percent),
           is_active = COALESCE($7, is_active)
       WHERE plan_id = $8
       RETURNING plan_id, name, description, duration_days, price, discount_percent, is_active`,
      [name, hasDescription, description, duration, price, discount, active, planId],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  }
}
