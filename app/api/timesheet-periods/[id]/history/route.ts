import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listTimesheetPeriodAuditHistory } from "@/lib/db"
import { withOperationalCapture } from "@/lib/api-outcome-capture"

export const runtime="nodejs"

async function getPeriodHistory(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const email=(await auth())?.user?.email
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if(!access.permissions.manage_timesheet_periods)return Response.json({error:"Period management permission is required."},{status:403})
    const {id}=await params
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return Response.json({error:"Invalid period ID."},{status:400})
    return Response.json({history:await listTimesheetPeriodAuditHistory(id)},{headers:{"Cache-Control":"no-store"}})
  }catch{
    return Response.json({error:"Period history unavailable."},{status:503})
  }
}

export const GET=withOperationalCapture("/api/timesheet-periods/[id]/history","GET",getPeriodHistory)
