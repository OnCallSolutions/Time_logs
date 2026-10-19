/** Corrects one entry only after its account-approved timesheet was recalled to this queue. */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { correctReopenedTimesheetEntry } from "@/lib/account-handoffs"

const schema=z.object({
  id:z.string().uuid(),periodId:z.string().uuid(),revision:z.string().datetime({offset:true}),
  project:z.string().trim().min(1).max(200),date:z.string().date(),hours:z.number().min(0.01).max(24),
  description:z.string().trim().min(1).max(2000),reason:z.string().trim().min(5).max(500),
}).strict()

export async function PATCH(request:Request){
  try{
    const email=(await auth())?.user?.email,access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if((access.role!=="account_manager"&&access.role!=="admin")||!access.permissions.view_accounts||!access.permissions.review_entries)return Response.json({error:"Timesheet correction rights are required."},{status:403})
    const input=schema.parse(await request.json())
    const updated=await correctReopenedTimesheetEntry(input,email,getAuditContext(request),access.role==="admin")
    if(!updated)return Response.json({error:"This entry is no longer in a recalled timesheet, has changed, or is outside your assigned queue."},{status:409})
    return Response.json({updated:true},{headers:{"Cache-Control":"no-store"}})
  }catch(error){
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    if(!invalid)console.error("[accounts/correct-entry] failed")
    return Response.json({error:invalid?"Provide valid corrected entry details and a reason.":"Entry could not be corrected."},{status:invalid?400:503})
  }
}
