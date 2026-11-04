import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["draft", "open", "closed", "completed", "cancelled"] as const;
type TournamentStatus = typeof VALID_STATUSES[number];

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  const customerId = auth.profile.customerId ?? -1;
  const isCustomer = auth.profile.role === "customer";

  try {
    const conditions: string[] = [];
    const params: unknown[] = [customerId];

    // Customers cannot view draft tournaments
    if (isCustomer) {
      conditions.push("t.status <> 'draft'");
    }

    if (statusFilter && VALID_STATUSES.includes(statusFilter as TournamentStatus)) {
      params.push(statusFilter);
      conditions.push(`t.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT
        t.tournament_id,
        t.name,
        t.game_id,
        g.title AS game_title,
        gc.category_name,
        t.prize_pool,
        t.start_date,
        t.status,
        t.max_participants,
        t.registration_deadline,
        t.description,
        COUNT(tr.customer_id)::int AS registered_count,
        COALESCE(bool_or(tr.customer_id = $1), false) AS is_registered
      FROM public.tournaments t
      LEFT JOIN public.games g ON g.game_id = t.game_id
      LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
      LEFT JOIN public.tournament_registrations tr ON tr.tournament_id = t.tournament_id
      ${whereClause}
      GROUP BY t.tournament_id, g.title, gc.category_name
      ORDER BY t.start_date ASC, t.tournament_id ASC;
    `;

    const result = await query(sql, params);
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
  const gameId = Number(body?.gameId);
  const prizePool = body?.prizePool !== undefined ? Number(body.prizePool) : 0;
  const startDate = String(body?.startDate ?? "").trim();
  const status = (String(body?.status ?? "open").trim().toLowerCase()) as TournamentStatus;
  const maxParticipants = body?.maxParticipants !== undefined && body.maxParticipants !== null
    ? Number(body.maxParticipants)
    : null;
  const registrationDeadline = body?.registrationDeadline ? new Date(body.registrationDeadline) : null;
  const description = String(body?.description ?? "").trim() || null;

  if (!name || name.length > 100) {
    return NextResponse.json({ error: "Tournament name is required (1-100 characters)." }, { status: 400 });
  }

  if (!Number.isInteger(gameId) || gameId <= 0) {
    return NextResponse.json({ error: "Valid gameId is required." }, { status: 400 });
  }

  if (Number.isNaN(prizePool) || prizePool < 0) {
    return NextResponse.json({ error: "Prize pool must be a non-negative number." }, { status: 400 });
  }

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) {
    return NextResponse.json({ error: "Start date must be a valid YYYY-MM-DD date." }, { status: 400 });
  }

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Allowed values: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  if (maxParticipants !== null && (!Number.isInteger(maxParticipants) || maxParticipants <= 0)) {
    return NextResponse.json({ error: "maxParticipants must be a positive integer if specified." }, { status: 400 });
  }

  if (registrationDeadline && Number.isNaN(registrationDeadline.getTime())) {
    return NextResponse.json({ error: "Invalid registration deadline timestamp." }, { status: 400 });
  }

  try {
    const gameCheck = await query("SELECT game_id FROM public.games WHERE game_id = $1;", [gameId]);
    if (gameCheck.rows.length === 0) {
      return NextResponse.json({ error: "Specified game does not exist." }, { status: 400 });
    }

    const insertSql = `
      INSERT INTO public.tournaments (
        name,
        game_id,
        prize_pool,
        start_date,
        status,
        max_participants,
        registration_deadline,
        description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;

    const result = await query(insertSql, [
      name,
      gameId,
      prizePool,
      startDate,
      status,
      maxParticipants,
      registrationDeadline ? registrationDeadline.toISOString() : null,
      description,
    ]);

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
