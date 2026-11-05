import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["draft", "open", "closed", "completed", "cancelled"] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const { tournamentId: rawId } = await params;
  const tournamentId = Number(rawId);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ error: "Invalid tournamentId." }, { status: 400 });
  }

  const customerId = auth.profile.customerId ?? -1;

  try {
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
        app_private.tournament_registration_count(t.tournament_id) AS registered_count,
        EXISTS (
          SELECT 1 FROM public.tournament_registrations AS own_registration
          WHERE own_registration.tournament_id = t.tournament_id
            AND own_registration.customer_id = $2
        ) AS is_registered
      FROM public.tournaments t
      LEFT JOIN public.games g ON g.game_id = t.game_id
      LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
      WHERE t.tournament_id = $1
      ;
    `;

    const result = await query(sql, [tournamentId, customerId]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }

    const tournament = result.rows[0];
    if (auth.profile.role === "customer" && tournament.status === "draft") {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }

    return NextResponse.json(tournament);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const { tournamentId: rawId } = await params;
  const tournamentId = Number(rawId);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ error: "Invalid tournamentId." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);

  const existingRes = await query<{ tournament_id: number; status: string }>(
    "SELECT tournament_id, status FROM public.tournaments WHERE tournament_id = $1;",
    [tournamentId]
  );

  if (existingRes.rows.length === 0) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  try {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 100) {
        return NextResponse.json({ error: "Tournament name must be 1-100 characters." }, { status: 400 });
      }
      values.push(name);
      updates.push(`name = $${values.length}`);
    }

    if (body?.status !== undefined) {
      const status = String(body.status).trim().toLowerCase();
      if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
        return NextResponse.json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
      }
      values.push(status);
      updates.push(`status = $${values.length}`);
    }

    if (body?.prizePool !== undefined) {
      const prizePool = Number(body.prizePool);
      if (Number.isNaN(prizePool) || prizePool < 0) {
        return NextResponse.json({ error: "Prize pool must be >= 0." }, { status: 400 });
      }
      values.push(prizePool);
      updates.push(`prize_pool = $${values.length}`);
    }

    if (body?.startDate !== undefined) {
      const startDate = String(body.startDate).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) {
        return NextResponse.json({ error: "Start date must be YYYY-MM-DD." }, { status: 400 });
      }
      values.push(startDate);
      updates.push(`start_date = $${values.length}`);
    }

    if (body?.maxParticipants !== undefined) {
      const maxParticipants = body.maxParticipants === null ? null : Number(body.maxParticipants);
      if (maxParticipants !== null && (!Number.isInteger(maxParticipants) || maxParticipants <= 0)) {
        return NextResponse.json({ error: "maxParticipants must be positive integer or null." }, { status: 400 });
      }
      values.push(maxParticipants);
      updates.push(`max_participants = $${values.length}`);
    }

    if (body?.registrationDeadline !== undefined) {
      const deadline = body.registrationDeadline ? new Date(body.registrationDeadline) : null;
      if (deadline && Number.isNaN(deadline.getTime())) {
        return NextResponse.json({ error: "Invalid registration deadline." }, { status: 400 });
      }
      values.push(deadline ? deadline.toISOString() : null);
      updates.push(`registration_deadline = $${values.length}`);
    }

    if (body?.description !== undefined) {
      const desc = String(body.description).trim() || null;
      values.push(desc);
      updates.push(`description = $${values.length}`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields provided for update." }, { status: 400 });
    }

    values.push(tournamentId);
    const updateSql = `
      UPDATE public.tournaments
      SET ${updates.join(", ")}
      WHERE tournament_id = $${values.length}
      RETURNING *;
    `;

    const result = await query(updateSql, values);
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const { tournamentId: rawId } = await params;
  const tournamentId = Number(rawId);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ error: "Invalid tournamentId." }, { status: 400 });
  }

  try {
    // Check if tournament has registrations
    const regCheck = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM public.tournament_registrations WHERE tournament_id = $1;",
      [tournamentId]
    );

    const regCount = Number(regCheck.rows[0]?.count ?? 0);
    if (regCount > 0) {
      return NextResponse.json(
        {
          error:
            "Tournament has registered participants and cannot be permanently deleted. Mark status as 'cancelled' instead to preserve customer history.",
          registeredCount: regCount,
        },
        { status: 409 }
      );
    }

    const deleteRes = await query(
      "DELETE FROM public.tournaments WHERE tournament_id = $1 RETURNING tournament_id;",
      [tournamentId]
    );

    if (deleteRes.rows.length === 0) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }

    return NextResponse.json({ message: "Tournament deleted successfully.", tournamentId });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
