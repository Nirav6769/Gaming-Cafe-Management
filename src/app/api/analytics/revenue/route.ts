import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Financial and revenue reports are strictly ADMIN ONLY
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  const startDateParam = url.searchParams.get("startDate") ?? thirtyDaysAgo.toISOString().slice(0, 10);
  const endDateParam = url.searchParams.get("endDate") ?? now.toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateParam) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateParam)) {
    return NextResponse.json({ error: "Dates must be formatted as YYYY-MM-DD." }, { status: 400 });
  }

  const start = new Date(startDateParam);
  const end = new Date(endDateParam);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date values." }, { status: 400 });
  }

  if (start > end) {
    return NextResponse.json({ error: "startDate must not be after endDate." }, { status: 400 });
  }

  const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  if (diffDays > 365) {
    return NextResponse.json({ error: "Date range cannot exceed 365 days." }, { status: 400 });
  }

  try {
    // Query view vw_daily_revenue created in migration 004
    // Combines sessions, paid snack orders, and active memberships without double counting
    const dailySql = `
      SELECT
        revenue_date::text AS revenue_date,
        source,
        SUM(amount)::numeric(10,2) AS total_amount,
        COUNT(*)::bigint AS transaction_count
      FROM public.vw_daily_revenue
      WHERE revenue_date >= $1 AND revenue_date <= $2
      GROUP BY revenue_date, source
      ORDER BY revenue_date DESC, source ASC;
    `;

    const summarySql = `
      SELECT
        source,
        SUM(amount)::numeric(10,2) AS source_total,
        COUNT(*)::bigint AS transaction_count
      FROM public.vw_daily_revenue
      WHERE revenue_date >= $1 AND revenue_date <= $2
      GROUP BY source;
    `;

    const [dailyRes, summaryRes] = await Promise.all([
      query<{
        revenue_date: string;
        source: string;
        total_amount: string;
        transaction_count: string;
      }>(dailySql, [startDateParam, endDateParam]),
      query<{
        source: string;
        source_total: string;
        transaction_count: string;
      }>(summarySql, [startDateParam, endDateParam]),
    ]);

    const sourceBreakdown: Record<string, number> = {
      session: 0,
      snack_order: 0,
      membership: 0,
    };

    let grandTotal = 0;
    for (const row of summaryRes.rows) {
      const amt = Number(row.source_total || 0);
      sourceBreakdown[row.source] = amt;
      grandTotal += amt;
    }

    return NextResponse.json({
      dailyRevenue: dailyRes.rows,
      sourceBreakdown,
      grandTotal: grandTotal.toFixed(2),
      range: {
        startDate: startDateParam,
        endDate: endDateParam,
        days: diffDays,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
