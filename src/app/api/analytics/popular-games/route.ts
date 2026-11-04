import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Admin and Staff have access to game popularity metrics
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const minPlaysParam = Number(url.searchParams.get("minPlays") ?? 0);
  const minPlays = Number.isInteger(minPlaysParam) && minPlaysParam >= 0 ? minPlaysParam : 0;

  const limitParam = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isInteger(limitParam) && limitParam >= 1 && limitParam <= 100 ? limitParam : 20;

  try {
    // Query view vw_popular_games created in migration 004
    const gamesSql = `
      SELECT
        game_id,
        title,
        category_name,
        is_active,
        play_count,
        total_recorded_minutes
      FROM public.vw_popular_games
      WHERE play_count >= $1
      ORDER BY play_count DESC, total_recorded_minutes DESC
      LIMIT $2;
    `;

    // Aggregate query grouping by category with HAVING clause for active play
    const categorySql = `
      SELECT
        COALESCE(gc.category_name, 'Uncategorized') AS category_name,
        COUNT(DISTINCT g.game_id)::bigint AS games_count,
        COUNT(sg.session_id)::bigint AS total_plays,
        COALESCE(SUM(sg.duration_minutes), 0)::bigint AS total_minutes
      FROM public.games g
      LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
      LEFT JOIN public.session_games sg ON sg.game_id = g.game_id
      GROUP BY gc.category_name
      ORDER BY total_plays DESC, total_minutes DESC;
    `;

    const [gamesResult, catResult] = await Promise.all([
      query(gamesSql, [minPlays, limit]),
      query(categorySql),
    ]);

    return NextResponse.json({
      popularGames: gamesResult.rows,
      categorySummary: catResult.rows,
      filter: { minPlays, limit },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
