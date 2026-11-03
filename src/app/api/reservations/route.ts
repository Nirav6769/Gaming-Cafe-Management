import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;
  const status = request.nextUrl.searchParams.get("status");
  try {
    const values: unknown[] = [];
    let where = "";
    if (auth.profile.role === "customer") {
      values.push(auth.profile.customerId);
      where = "WHERE r.customer_id = $1";
    }
    if (status && ["confirmed","cancelled","completed"].includes(status)) {
      values.push(status);
      where += where ? " AND r.status = $2" : "WHERE r.status = $1";
    }
    const result = await pool.query(`SELECT r.reservation_id,r.customer_id,c.name AS customer_name,r.pc_id,p.pc_name,r.start_time,r.end_time,r.status,r.notes,r.created_at
      FROM reservations r JOIN customers c USING(customer_id) JOIN gaming_pcs p USING(pc_id)
      ${where} ORDER BY r.start_time DESC LIMIT 200`, values);
    return NextResponse.json(result.rows);
  } catch (error) {
    return NextResponse.json({error:errorMessage(error)}, {status:500});
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin","staff"]);
  if (auth.response) return auth.response;
  const body = await request.json().catch(()=>null);
  const customerId=Number(body?.customerId), pcId=Number(body?.pcId);
  const startTime=new Date(body?.startTime), endTime=new Date(body?.endTime);
  if (!Number.isInteger(customerId)||customerId<1||!Number.isInteger(pcId)||pcId<1||
      !Number.isFinite(startTime.getTime())||!Number.isFinite(endTime.getTime())||endTime<=startTime)
    return NextResponse.json({error:"Provide a customer, PC, valid start and end time."},{status:400});
  try {
    const result=await pool.query(`INSERT INTO reservations(customer_id,pc_id,start_time,end_time,notes,created_by_staff_id)
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING reservation_id,customer_id,pc_id,start_time,end_time,status,notes`,
      [customerId,pcId,startTime.toISOString(),endTime.toISOString(),String(body?.notes??"").trim()||null,auth.profile.staffId]);
    return NextResponse.json(result.rows[0],{status:201});
  } catch(error) {
    const message=errorMessage(error);
    return NextResponse.json({error:message.includes("exclusion")||message.includes("overlap")?"That PC is already booked for this time.":message},{status:409});
  }
}
