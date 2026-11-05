import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ membershipId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;

  const { membershipId: rawId } = await context.params;
  const membershipId = Number(rawId);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(membershipId) || membershipId < 1 || body?.status !== "cancelled") {
    return NextResponse.json({ error: "Only cancellation of a valid membership is supported." }, { status: 400 });
  }

  try {
    const result = await query(
      `UPDATE public.customer_memberships
       SET status = 'cancelled'
       WHERE membership_id = $1 AND status = 'active'
       RETURNING membership_id, customer_id, status, start_at, end_at`,
      [membershipId],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Active membership not found." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
