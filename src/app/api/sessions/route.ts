import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;
  try {
    if (auth.profile.role === "customer") {
      const own = await pool.query(`SELECT s.session_id,s.customer_id,c.name AS customer_name,s.pc_id,p.pc_name,
        s.start_time,s.expected_end_time,s.end_time,s.total_cost,
        CASE WHEN s.end_time IS NULL THEN 'active' ELSE 'completed' END AS status
        FROM gaming_sessions s JOIN customers c USING(customer_id) JOIN gaming_pcs p USING(pc_id)
        WHERE s.customer_id=$1 ORDER BY s.start_time DESC LIMIT 100`,[auth.profile.customerId]);
      return NextResponse.json(own.rows);
    }
    const result = await pool.query(`SELECT s.session_id,s.customer_id,c.name AS customer_name,s.pc_id,p.pc_name,
      s.start_time,s.expected_end_time,s.end_time,s.total_cost,s.hourly_rate_snapshot,
      CASE WHEN s.end_time IS NULL THEN 'active' ELSE 'completed' END AS status
      FROM gaming_sessions s JOIN customers c USING(customer_id) JOIN gaming_pcs p USING(pc_id)
      ORDER BY s.start_time DESC LIMIT 200`);
    return NextResponse.json(result.rows);
  } catch (error) { return NextResponse.json({error:errorMessage(error)},{status:500}); }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await request.json().catch(()=>null);
  const customerId=Number(body?.customerId), pcId=Number(body?.pcId);
  const duration=Number(body?.durationMinutes ?? 120);
  const reservationId=body?.reservationId==null?null:Number(body.reservationId);
  if(!Number.isInteger(customerId)||customerId<1||!Number.isInteger(pcId)||pcId<1||
     !Number.isInteger(duration)||duration<30||duration>480||
     (reservationId!==null&&(!Number.isInteger(reservationId)||reservationId<1)))
    return NextResponse.json({error:"Choose a customer and PC. Session duration must be 30–480 minutes."},{status:400});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const pc=await client.query("SELECT pc_id,status,hourly_rate FROM gaming_pcs WHERE pc_id=$1 FOR UPDATE",[pcId]);
    if(!pc.rowCount)throw new Error("PC not found.");
    if(pc.rows[0].status!=="available")throw new Error("This PC is not available.");
    const customer=await client.query("SELECT customer_id FROM customers WHERE customer_id=$1",[customerId]);
    if(!customer.rowCount)throw new Error("Customer not found.");
    if(reservationId!==null){
      const reservation=await client.query(`SELECT reservation_id FROM reservations
        WHERE reservation_id=$1 AND pc_id=$2 AND customer_id=$3 AND status='confirmed'
        AND start_time<=CURRENT_TIMESTAMP AND end_time>CURRENT_TIMESTAMP FOR UPDATE`,[reservationId,pcId,customerId]);
      if(!reservation.rowCount)throw new Error("A matching active reservation was not found.");
    }
    const inserted=await client.query(`INSERT INTO gaming_sessions(customer_id,pc_id,expected_end_time,reservation_id,hourly_rate_snapshot)
      VALUES($1,$2,CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'),$4,$5)
      RETURNING session_id,customer_id,pc_id,start_time,expected_end_time,hourly_rate_snapshot`,
      [customerId,pcId,duration,reservationId,pc.rows[0].hourly_rate]);
    await client.query("COMMIT");
    return NextResponse.json(inserted.rows[0],{status:201});
  }catch(error){
    await client.query("ROLLBACK");
    const message=errorMessage(error);
    return NextResponse.json({error:message.includes("overlap")||message.includes("exclusion")?"This PC conflicts with a confirmed reservation or active session.":message},{status:409});
  }finally{client.release();}
}
