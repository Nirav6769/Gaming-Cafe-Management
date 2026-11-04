import { NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const isAdmin = auth.profile.role === "admin";

  try {
    const [pcStats, sessionStats, gamesCount, topGameRes] = await Promise.all([
      query<{
        total: string;
        available: string;
        occupied: string;
        maintenance: string;
      }>(`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE status = 'available')::text AS available,
          COUNT(*) FILTER (WHERE status = 'occupied')::text AS occupied,
          COUNT(*) FILTER (WHERE status = 'maintenance')::text AS maintenance
        FROM public.gaming_pcs;
      `),
      query<{
        active: string;
        completed: string;
        total_minutes: string;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE end_time IS NULL)::text AS active,
          COUNT(*) FILTER (WHERE end_time IS NOT NULL)::text AS completed,
          COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60) FILTER (WHERE end_time IS NOT NULL), 0)::text AS total_minutes
        FROM public.gaming_sessions;
      `),
      query<{ count: string }>("SELECT COUNT(*)::text AS count FROM public.games WHERE is_active = TRUE;"),
      query<{ title: string; play_count: string }>(`
        SELECT g.title, COUNT(sg.session_id)::text AS play_count
        FROM public.games g
        JOIN public.session_games sg ON sg.game_id = g.game_id
        GROUP BY g.game_id, g.title
        ORDER BY COUNT(sg.session_id) DESC
        LIMIT 1;
      `),
    ]);

    let todayRevenue: string | undefined = undefined;
    let monthlyRevenue: string | undefined = undefined;

    if (isAdmin) {
      const revenueRes = await query<{
        today: string;
        month: string;
      }>(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE revenue_date = CURRENT_DATE), 0)::numeric(10,2)::text AS today,
          COALESCE(SUM(amount) FILTER (WHERE revenue_date >= DATE_TRUNC('month', CURRENT_DATE)), 0)::numeric(10,2)::text AS month
        FROM public.vw_daily_revenue;
      `);
      todayRevenue = revenueRes.rows[0]?.today ?? "0.00";
      monthlyRevenue = revenueRes.rows[0]?.month ?? "0.00";
    }

    const totalMinutes = Number(sessionStats.rows[0]?.total_minutes ?? 0);

    return NextResponse.json({
      role: auth.profile.role,
      pcs: {
        total: Number(pcStats.rows[0]?.total ?? 0),
        available: Number(pcStats.rows[0]?.available ?? 0),
        occupied: Number(pcStats.rows[0]?.occupied ?? 0),
        maintenance: Number(pcStats.rows[0]?.maintenance ?? 0),
      },
      sessions: {
        active: Number(sessionStats.rows[0]?.active ?? 0),
        completed: Number(sessionStats.rows[0]?.completed ?? 0),
        totalObservedHours: Number((totalMinutes / 60).toFixed(1)),
      },
      games: {
        activeCount: Number(gamesCount.rows[0]?.count ?? 0),
        topGame: topGameRes.rows[0]?.title ?? "None yet",
        topGamePlays: Number(topGameRes.rows[0]?.play_count ?? 0),
      },
      revenue: isAdmin
        ? {
            today: todayRevenue,
            currentMonth: monthlyRevenue,
          }
        : undefined,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
