import {NextRequest,NextResponse} from "next/server";
import {pool,errorMessage} from "@/lib/db";
import {requireApiRole} from "@/lib/auth";
type Context={params:Promise<{maintenanceId:string}>};
export async function PATCH(_request:NextRequest,{params}:Context){
 const auth=await requireApiRole(["admin","staff"]);if(auth.response)return auth.response;
 const id=Number((await params).maintenanceId);if(!Number.isInteger(id)||id<1)return NextResponse.json({error:"Invalid maintenance ID."},{status:400});
 try{const r=await pool.query(`UPDATE maintenance_records SET resolved=TRUE,resolved_at=CURRENT_TIMESTAMP WHERE maintenance_id=$1 AND resolved=FALSE
 RETURNING maintenance_id,pc_id,maintenance_date,issue_description,resolved,resolved_at`,[id]);
 if(!r.rowCount)return NextResponse.json({error:"Open maintenance record not found."},{status:404});return NextResponse.json(r.rows[0]);}
 catch(e){return NextResponse.json({error:errorMessage(e)},{status:500});}
}
