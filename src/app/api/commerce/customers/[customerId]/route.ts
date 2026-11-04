import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";
import { isValidCustomerEmail } from "@/lib/validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ customerId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const { customerId: rawId } = await context.params;
  const customerId = Number(rawId);
  if (!Number.isInteger(customerId) || customerId < 1) {
    return NextResponse.json({ error: "Invalid customer ID." }, { status: 400 });
  }

  if (auth.profile.role === "customer" && auth.profile.customerId !== customerId) {
    return NextResponse.json({ error: "You can only update your own profile." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const phone = String(body?.phone ?? "").trim() || null;
  if (!name || name.length > 100 || !isValidCustomerEmail(email) ||
      email.length > 100 || (phone && phone.length > 15)) {
    return NextResponse.json({ error: "Enter a name, valid email and phone number up to 15 characters." }, { status: 400 });
  }

  try {
    const result = await query(
      `UPDATE public.customers
       SET name = $1, email = $2, phone = $3
       WHERE customer_id = $4
       RETURNING customer_id, name, email, phone, join_date, updated_at`,
      [name, email, phone, customerId],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json(
      { error: message.includes("customers_email_key") ? "That email is already registered." : message },
      { status: message.includes("customers_email_key") ? 409 : 500 },
    );
  }
}
