import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const result = await query(`SELECT customer_id, name, email, phone, join_date
      FROM customers
      WHERE name ILIKE $1 OR email ILIKE $1 OR COALESCE(phone, '') ILIKE $1
      ORDER BY name LIMIT 100`, [`%${search}%`]);
    return NextResponse.json(result.rows);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const phone = String(body?.phone ?? "").trim() || null;
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    return NextResponse.json({ error: "Enter a name and valid email address." }, { status: 400 });
  }
  try {
    const result = await query(`INSERT INTO customers (name, email, phone)
      VALUES ($1, $2, $3) RETURNING customer_id, name, email, phone, join_date`, [name, email, phone]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json({ error: message.includes("customers_email_key") ? "That email is already registered." : message }, { status: 500 });
  }
}
