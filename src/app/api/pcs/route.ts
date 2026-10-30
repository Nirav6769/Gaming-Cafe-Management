import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await query(`SELECT p.pc_id, p.pc_name, p.status, p.hourly_rate,
      s.session_id, s.start_time, c.name AS customer_name
      FROM gaming_pcs p
      LEFT JOIN gaming_sessions s ON s.pc_id = p.pc_id AND s.end_time IS NULL
      LEFT JOIN customers c ON c.customer_id = s.customer_id
      ORDER BY p.pc_id`);
    return NextResponse.json(result.rows);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const pcId = Number(body?.pcId);
  const status = body?.status;
  if (!Number.isInteger(pcId) || !["available", "maintenance"].includes(status)) {
    return NextResponse.json({ error: "Valid PC and status are required." }, { status: 400 });
  }
  try {
    const active = await query("SELECT 1 FROM gaming_sessions WHERE pc_id = $1 AND end_time IS NULL", [pcId]);
    if (active.rowCount) return NextResponse.json({ error: "End the active session before changing this PC's status." }, { status: 409 });
    const result = await query("UPDATE gaming_pcs SET status = $1 WHERE pc_id = $2 RETURNING pc_id, pc_name, status, hourly_rate", [status, pcId]);
    if (!result.rowCount) return NextResponse.json({ error: "PC not found." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
