import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

  try {
    if (auth.profile.role === "customer") {
      const customerId = auth.profile.customerId;
      if (!customerId) {
        return NextResponse.json({ error: "No customer profile associated with user." }, { status: 403 });
      }

      const res = await query(
        `
        SELECT tr.tournament_id, tr.customer_id, tr.registration_date
        FROM public.tournament_registrations tr
        WHERE tr.tournament_id = $1 AND tr.customer_id = $2;
        `,
        [tournamentId, customerId]
      );
      return NextResponse.json(res.rows);
    }

    // Admin & Staff see full participant roster
    const res = await query(
      `
      SELECT
        tr.tournament_id,
        tr.customer_id,
        c.name AS customer_name,
        c.email AS customer_email,
        tr.registration_date
      FROM public.tournament_registrations tr
      JOIN public.customers c ON c.customer_id = tr.customer_id
      WHERE tr.tournament_id = $1
      ORDER BY tr.registration_date ASC;
      `,
      [tournamentId]
    );

    return NextResponse.json(res.rows);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(
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

  let targetCustomerId: number;
  if (auth.profile.role === "customer") {
    if (!auth.profile.customerId) {
      return NextResponse.json({ error: "Customer profile not found." }, { status: 403 });
    }
    targetCustomerId = auth.profile.customerId;
  } else {
    // Admin / Staff can register on behalf of a specific customer
    const body = await request.json().catch(() => null);
    const bodyCustId = Number(body?.customerId);
    if (!Number.isInteger(bodyCustId) || bodyCustId <= 0) {
      return NextResponse.json({ error: "Valid customerId is required." }, { status: 400 });
    }
    targetCustomerId = bodyCustId;
  }

  try {
    // Verify customer exists
    const customerCheck = await query("SELECT customer_id FROM public.customers WHERE customer_id = $1;", [targetCustomerId]);
    if (customerCheck.rows.length === 0) {
      return NextResponse.json({ error: "Customer does not exist." }, { status: 404 });
    }

    // Insert registration: triggers database-level concurrency lock and checks (trigger games_guard_tournament_registration)
    const sql = `
      INSERT INTO public.tournament_registrations (tournament_id, customer_id)
      VALUES ($1, $2)
      RETURNING tournament_id, customer_id, registration_date;
    `;

    const result = await query(sql, [tournamentId, targetCustomerId]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };

    // Duplicate registration (composite primary key violation)
    if (err?.code === "23505") {
      return NextResponse.json(
        { error: "Customer is already registered for this tournament." },
        { status: 409 }
      );
    }

    // Capacity, deadline, or status violation raised by trigger games_guard_tournament_registration
    if (err?.code === "23514" || err?.code === "P0001") {
      return NextResponse.json(
        { error: err.message || "Tournament is not open for registration." },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
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

  const url = new URL(request.url);
  let targetCustomerId: number;

  if (auth.profile.role === "customer") {
    if (!auth.profile.customerId) {
      return NextResponse.json({ error: "Customer profile not found." }, { status: 403 });
    }
    targetCustomerId = auth.profile.customerId;
  } else {
    // Admin / Staff can specify customerId to cancel
    const paramCustId = Number(url.searchParams.get("customerId"));
    if (!Number.isInteger(paramCustId) || paramCustId <= 0) {
      return NextResponse.json({ error: "customerId query parameter is required." }, { status: 400 });
    }
    targetCustomerId = paramCustId;
  }

  try {
    // Check tournament deadline and start date
    const tournCheck = await query<{
      status: string;
      registration_deadline: string | null;
      start_date: string;
    }>(
      "SELECT status, registration_deadline, start_date FROM public.tournaments WHERE tournament_id = $1;",
      [tournamentId]
    );

    if (tournCheck.rows.length === 0) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }

    const tournament = tournCheck.rows[0];
    if (tournament.registration_deadline && new Date() > new Date(tournament.registration_deadline)) {
      return NextResponse.json(
        { error: "Registration deadline has passed. Cancellation is no longer permitted." },
        { status: 400 }
      );
    }
    if (!tournament.registration_deadline && tournament.start_date && new Date().toISOString().slice(0, 10) > tournament.start_date) {
      return NextResponse.json(
        { error: "Tournament has already started. Cancellation is no longer permitted." },
        { status: 400 }
      );
    }

    const deleteRes = await query(
      `
      DELETE FROM public.tournament_registrations
      WHERE tournament_id = $1 AND customer_id = $2
      RETURNING tournament_id, customer_id;
      `,
      [tournamentId, targetCustomerId]
    );

    if (deleteRes.rows.length === 0) {
      return NextResponse.json({ error: "Registration not found." }, { status: 404 });
    }

    return NextResponse.json({
      message: "Registration cancelled successfully.",
      tournamentId,
      customerId: targetCustomerId,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
