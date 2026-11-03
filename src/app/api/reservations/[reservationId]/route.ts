import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

type Context={params:Promise<{reservationId:string}>};
export async function PATCH(request:NextRequest,{params}:Context){
  const auth=await requireApiRole(["admin","staff"]);
  if(auth.response)return auth.response;
  const {reservationId}=await params, id=Number(reservationId);
  const body=await request.json().catch(()=>null);
  const status=body?.status;
  if(!Number.isInteger(id)||id<1||!["cancelled","completed"].includes(status))
    return NextResponse.json({error:"Invalid reservation or status."},{status:400});
  try{
    const result=await pool.query(`UPDATE reservations SET status=$1 WHERE reservation_id=$2 AND status='confirmed'
      RETURNING reservation_id,status`,[status,id]);
    if(!result.rowCount)return NextResponse.json({error:"Confirmed reservation not found."},{status:404});
    return NextResponse.json(result.rows[0]);
  }catch(error){return NextResponse.json({error:errorMessage(error)},{status:500});}
}
