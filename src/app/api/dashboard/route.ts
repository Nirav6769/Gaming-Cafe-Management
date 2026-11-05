import { NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [pcs, sessions, revenue] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'available')::int AS available,
        COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied,
        COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance
        FROM gaming_pcs`),
      query(`SELECT COUNT(*)::int AS active FROM gaming_sessions WHERE end_time IS NULL`),
      query(`SELECT COALESCE(SUM(total_cost), 0)::numeric(12,2) AS today
        FROM gaming_sessions
        WHERE end_time IS NOT NULL AND start_time::date = CURRENT_DATE`),
    ]);
    return NextResponse.json({
      pcs: pcs.rows[0],
      activeSessions: sessions.rows[0].active,
      todayRevenue: revenue.rows[0].today,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
