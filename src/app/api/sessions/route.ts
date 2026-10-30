import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(`SELECT s.session_id, s.customer_id, c.name AS customer_name,
      s.pc_id, p.pc_name, s.start_time, s.end_time, s.total_cost,
      CASE WHEN s.end_time IS NULL THEN 'active' ELSE 'completed' END AS status
      FROM gaming_sessions s
      JOIN customers c ON c.customer_id = s.customer_id
      JOIN gaming_pcs p ON p.pc_id = s.pc_id
      ORDER BY s.start_time DESC LIMIT 100`);
    return NextResponse.json(result.rows);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const customerId = Number(body?.customerId);
  const pcId = Number(body?.pcId);
  if (!Number.isInteger(customerId) || !Number.isInteger(pcId)) {
    return NextResponse.json({ error: "Select a customer and PC." }, { status: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pc = await client.query("SELECT pc_id, status FROM gaming_pcs WHERE pc_id = $1 FOR UPDATE", [pcId]);
    if (!pc.rowCount) throw new Error("PC not found.");
    if (pc.rows[0].status !== "available") throw new Error("This PC is not available.");
    const customer = await client.query("SELECT customer_id FROM customers WHERE customer_id = $1", [customerId]);
    if (!customer.rowCount) throw new Error("Customer not found.");
    const session = await client.query(`INSERT INTO gaming_sessions (customer_id, pc_id)
      VALUES ($1, $2) RETURNING session_id, customer_id, pc_id, start_time`, [customerId, pcId]);
    await client.query("UPDATE gaming_pcs SET status = 'occupied' WHERE pc_id = $1", [pcId]);
    await client.query("COMMIT");
    return NextResponse.json(session.rows[0], { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = errorMessage(error);
    return NextResponse.json({ error: message.includes("one_active_session_per_pc") ? "This PC already has an active session." : message }, { status: 409 });
  } finally {
    client.release();
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const sessionId = Number(body?.sessionId);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "Valid session ID required." }, { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT s.session_id, s.pc_id, s.start_time, p.hourly_rate
      FROM gaming_sessions s JOIN gaming_pcs p ON p.pc_id = s.pc_id
      WHERE s.session_id = $1 AND s.end_time IS NULL FOR UPDATE OF s, p`, [sessionId]);
    if (!result.rowCount) throw new Error("Active session not found.");
    const session = result.rows[0];
    const updated = await client.query(`UPDATE gaming_sessions
      SET end_time = CURRENT_TIMESTAMP,
          total_cost = ROUND((hourly_rate * GREATEST(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - $2::timestamp)) / 3600, 0))::numeric, 2)
      FROM gaming_pcs
      WHERE gaming_sessions.session_id = $1 AND gaming_pcs.pc_id = $3
      RETURNING gaming_sessions.session_id, gaming_sessions.end_time, gaming_sessions.total_cost`,
      [sessionId, session.start_time, session.pc_id]);
    await client.query("UPDATE gaming_pcs SET status = 'available' WHERE pc_id = $1", [session.pc_id]);
    await client.query("COMMIT");
    return NextResponse.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  } finally {
    client.release();
  }
}
