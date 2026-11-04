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

  if (
    !name || name.length > 80 ||
    !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650 ||
    !Number.isFinite(price) || price < 0 || price > 1000000 ||
    !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100
  ) {
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
      { status: 409 },
    );
  }
}
