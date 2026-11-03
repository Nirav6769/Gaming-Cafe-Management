import { NextRequest, NextResponse } from "next/server";
import { pool, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";

type Context={params:Promise<{sessionId:string}>};
export async function GET(_request:NextRequest,{params}:Context){
  const auth=await requireApiRole(["admin","staff","customer"]);
  if(auth.response)return auth.response;
  const id=Number((await params).sessionId);
  if(!Number.isInteger(id)||id<1)return NextResponse.json({error:"Invalid session ID."},{status:400});
  try{
    const owner=auth.profile.role==="customer"?"AND s.customer_id=$2":"";
    const values:unknown[]=auth.profile.role==="customer"?[id,auth.profile.customerId]:[id];
    const result=await pool.query(`SELECT sg.session_id,sg.game_id,g.title,sg.duration_minutes,sg.added_at
      FROM session_games sg JOIN games g USING(game_id) JOIN gaming_sessions s USING(session_id)
      WHERE sg.session_id=$1 ${owner} ORDER BY sg.added_at`,values);
    return NextResponse.json(result.rows);
  }catch(error){return NextResponse.json({error:errorMessage(error)},{status:500});}
}
export async function POST(request:NextRequest,{params}:Context){
  const auth=await requireApiRole(["admin","staff"]);
  if(auth.response)return auth.response;
  const id=Number((await params).sessionId), body=await request.json().catch(()=>null);
  const gameId=Number(body?.gameId), duration=body?.durationMinutes==null?null:Number(body.durationMinutes);
  if(!Number.isInteger(id)||id<1||!Number.isInteger(gameId)||gameId<1||
    (duration!==null&&(!Number.isInteger(duration)||duration<0||duration>1440)))
    return NextResponse.json({error:"Valid session, game and duration are required."},{status:400});
  try{
    const active=await pool.query("SELECT 1 FROM gaming_sessions WHERE session_id=$1 AND end_time IS NULL",[id]);
    if(!active.rowCount)return NextResponse.json({error:"Session is not active."},{status:409});
    const result=await pool.query(`INSERT INTO session_games(session_id,game_id,duration_minutes)
      VALUES($1,$2,$3) ON CONFLICT(session_id,game_id) DO UPDATE SET duration_minutes=EXCLUDED.duration_minutes
      RETURNING session_id,game_id,duration_minutes,added_at`,[id,gameId,duration]);
    return NextResponse.json(result.rows[0],{status:201});
  }catch(error){return NextResponse.json({error:errorMessage(error)},{status:409});}
}
