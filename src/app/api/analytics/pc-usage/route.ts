import { NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  // Accessible to Admin and Staff; revenue column is masked for Staff
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const isAdmin = auth.profile.role === "admin";

  try {
    // Query view vw_pc_usage_summary created in migration 004
    const sql = `
      SELECT
        pc_id,
        pc_name,
        status,
        hourly_rate,
        completed_sessions_count,
        total_used_minutes,
        total_session_revenue
      FROM public.vw_pc_usage_summary
      ORDER BY total_used_minutes DESC, completed_sessions_count DESC;
    `;

    const result = await query<{
      pc_id: number;
      pc_name: string;
      status: string;
      hourly_rate: string;
      completed_sessions_count: string;
      total_used_minutes: string;
      total_session_revenue: string;
    }>(sql);

    // If staff, mask out revenue figures to enforce admin-only financial visibility
    const pcUsage = result.rows.map((row) => ({
      pc_id: row.pc_id,
      pc_name: row.pc_name,
      status: row.status,
      hourly_rate: row.hourly_rate,
      completed_sessions_count: Number(row.completed_sessions_count),
      total_used_minutes: Number(row.total_used_minutes),
      total_session_revenue: isAdmin ? row.total_session_revenue : undefined,
    }));

    const totalObservedMinutes = pcUsage.reduce((sum, p) => sum + p.total_used_minutes, 0);
    const totalSessions = pcUsage.reduce((sum, p) => sum + p.completed_sessions_count, 0);

    return NextResponse.json({
      pcUsage,
      summary: {
        totalPCs: pcUsage.length,
        totalObservedMinutes,
        totalObservedHours: Number((totalObservedMinutes / 60).toFixed(1)),
        totalCompletedSessions: totalSessions,
        metricDisclaimer: "Metrics reflect observed session durations recorded in database.",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
