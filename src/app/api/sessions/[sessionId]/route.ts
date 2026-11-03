import {NextResponse} from "next/server";
import {pool,errorMessage} from "@/lib/db";
import {requireApiRole} from "@/lib/auth";
type Context={params:Promise<{sessionId:string}>};
export async function PATCH(_request:Request,{params}:Context){
 const auth=await requireApiRole(["admin","staff"]);if(auth.response)return auth.response;
 const id=Number((await params).sessionId);
 if(!Number.isInteger(id)||id<1)return NextResponse.json({error:"Invalid session ID."},{status:400});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const locked=await client.query("SELECT session_id,pc_id FROM gaming_sessions WHERE session_id=$1 AND end_time IS NULL FOR UPDATE",[id]);
  if(!locked.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Active session not found."},{status:404});}
  const result=await client.query(`UPDATE gaming_sessions SET end_time=CURRENT_TIMESTAMP
    WHERE session_id=$1 RETURNING session_id,pc_id,start_time,end_time,total_cost,hourly_rate_snapshot`,[id]);
  await client.query("COMMIT");
  return NextResponse.json(result.rows[0]);
 }catch(error){
  await client.query("ROLLBACK");
  return NextResponse.json({error:errorMessage(error)},{status:409});
 }finally{client.release();}
}
