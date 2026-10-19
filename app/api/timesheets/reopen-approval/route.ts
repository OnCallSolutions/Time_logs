/** Sends an account-manager-approved timesheet back to the internal approval queue. */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { reopenApprovedTimesheet } from "@/lib/account-handoffs"

export const runtime="nodejs"

const schema=z.object({
  ownerEmail:z.string().email(),periodId:z.string().uuid(),startDate:z.string().date(),endDate:z.string().date(),
  reason:z.string().trim().min(5).max(500),selection:z.array(z.object({id:z.string().uuid(),revision:z.string().datetime({offset:true})}).strict()).min(1).max(100),
}).strict()

export async function POST(req:Request){
  try{
    const email=(await auth())?.user?.email,access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if(access.role!=="account_manager"&&access.role!=="admin")return Response.json({error:"Only account managers can reopen a final approval."},{status:403})
    if(!access.permissions.view_accounts||!access.permissions.review_entries)return Response.json({error:"Final approval rights are required."},{status:403})
    const input=schema.parse(await req.json())
    if(input.startDate>input.endDate)return Response.json({error:"Invalid period range."},{status:400})
    const entries=await reopenApprovedTimesheet(input,email,getAuditContext(req),access.role==="admin")
    if(entries.length!==input.selection.length)return Response.json({error:"The complete approved timesheet changed or is no longer eligible. Refresh final approved timesheets and retry."},{status:409})
    return Response.json({entries,destination:"approval_queue"},{headers:{"Cache-Control":"no-store"}})
  }catch(error){
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    if(!invalid)console.error("[timesheets/reopen-approval] failed")
    return Response.json({error:invalid?"Enter the complete timesheet, period, revisions, and a reason.":"Timesheet could not be reopened."},{status:invalid?400:503})
  }
}
