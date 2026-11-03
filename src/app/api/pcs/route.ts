import { NextRequest, NextResponse } from "next/server";
import { pool, query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;
  try {
    const result = await query(`SELECT p.pc_id,p.pc_name,p.status,p.hourly_rate,
      s.session_id,s.start_time,c.name AS customer_name
      FROM gaming_pcs p LEFT JOIN gaming_sessions s ON s.pc_id=p.pc_id AND s.end_time IS NULL
      LEFT JOIN customers c ON c.customer_id=s.customer_id ORDER BY p.pc_id`);
    return NextResponse.json(result.rows);
  } catch(error) { return NextResponse.json({error:errorMessage(error)},{status:500}); }
}

export async function PATCH(request:NextRequest) {
  const auth=await requireApiRole(["admin","staff"]);
  if(auth.response)return auth.response;
  const body=await request.json().catch(()=>null),pcId=Number(body?.pcId),status=body?.status;
  if(!Number.isInteger(pcId)||pcId<1||!["available","maintenance"].includes(status))
    return NextResponse.json({error:"Valid PC and status are required."},{status:400});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const pc=await client.query("SELECT pc_id FROM gaming_pcs WHERE pc_id=$1 FOR UPDATE",[pcId]);
    if(!pc.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"PC not found."},{status:404});}
    if(status==="maintenance") {
      const active=await client.query("SELECT 1 FROM gaming_sessions WHERE pc_id=$1 AND end_time IS NULL",[pcId]);
      if(active.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"End the active session before logging maintenance."},{status:409});}
      await client.query(`INSERT INTO maintenance_records(pc_id,maintenance_date,issue_description,resolved)
        VALUES($1,CURRENT_DATE,'Marked for maintenance from PC management',FALSE)`,[pcId]);
    } else {
      await client.query(`UPDATE maintenance_records SET resolved=TRUE,resolved_at=CURRENT_TIMESTAMP
        WHERE pc_id=$1 AND resolved=FALSE`,[pcId]);
    }
    const result=await client.query("SELECT pc_id,pc_name,status,hourly_rate FROM gaming_pcs WHERE pc_id=$1",[pcId]);
    await client.query("COMMIT");
    return NextResponse.json(result.rows[0]);
  } catch(error) {
    await client.query("ROLLBACK");
    return NextResponse.json({error:errorMessage(error)},{status:409});
  } finally { client.release(); }
}
