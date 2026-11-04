import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";
import { isValidCustomerEmail } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  try {
    const search = auth.profile.role === "customer"
      ? ""
      : request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const result = await query(
      `SELECT customer_id, name, email, phone, join_date, updated_at
       FROM public.customers
       WHERE ($1::INTEGER IS NULL OR customer_id = $1)
         AND ($2::TEXT = '' OR name ILIKE $3 OR email ILIKE $3 OR COALESCE(phone, '') ILIKE $3)
       ORDER BY name
       LIMIT 100`,
      [
        auth.profile.role === "customer" ? auth.profile.customerId : null,
        search,
        `%${search}%`,
      ],
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

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
      `INSERT INTO public.customers (name, email, phone)
       VALUES ($1, $2, $3)
       RETURNING customer_id, name, email, phone, join_date, updated_at`,
      [name, email, phone],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json(
      { error: message.includes("customers_email_key") ? "That email is already registered." : message },
      { status: message.includes("customers_email_key") ? 409 : 500 },
    );
  }
}
