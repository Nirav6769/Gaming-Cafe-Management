import { NextRequest,NextResponse } from "next/server";
import { pool,errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";
export const dynamic="force-dynamic";
export async function GET(){
 const auth=await requireApiRole(["admin","staff"]); if(auth.response)return auth.response;
 try{const r=await pool.query(`SELECT m.maintenance_id,m.pc_id,p.pc_name,m.maintenance_date,m.issue_description,m.resolved,m.resolved_at
 FROM maintenance_records m JOIN gaming_pcs p USING(pc_id) ORDER BY m.maintenance_date DESC,m.maintenance_id DESC LIMIT 200`);return NextResponse.json(r.rows);}
 catch(e){return NextResponse.json({error:errorMessage(e)},{status:500});}
}
export async function POST(request:NextRequest){
 const auth=await requireApiRole(["admin","staff"]);if(auth.response)return auth.response;
 const b=await request.json().catch(()=>null),pcId=Number(b?.pcId),description=String(b?.issueDescription??"").trim(),date=String(b?.maintenanceDate??new Date().toISOString().slice(0,10));
 if(!Number.isInteger(pcId)||pcId<1||!description||description.length>2000||!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:"PC, date and issue description are required."},{status:400});
 try{const r=await pool.query(`INSERT INTO maintenance_records(pc_id,maintenance_date,issue_description,resolved) VALUES($1,$2,$3,FALSE)
 RETURNING maintenance_id,pc_id,maintenance_date,issue_description,resolved,resolved_at`,[pcId,date,description]);return NextResponse.json(r.rows[0],{status:201});}
 catch(e){return NextResponse.json({error:errorMessage(e)},{status:409});}
}
