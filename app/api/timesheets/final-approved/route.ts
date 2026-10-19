/** Lists entry IDs in the signed-in account manager's current final-approved archive. */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listAccountApprovedEntryIds } from "@/lib/account-handoffs"
import { withOperationalCapture } from "@/lib/api-outcome-capture"

async function getFinalApprovedTimesheets(){
  try{
    const email=(await auth())?.user?.email,access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if((access.role!=="account_manager"&&access.role!=="admin")||!access.permissions.view_accounts||!access.permissions.review_entries)return Response.json({error:"Final approved timesheets are restricted to account managers with approval rights."},{status:403})
    const entryIds=await listAccountApprovedEntryIds(email,access.role==="admin")
    return Response.json({entryIds},{headers:{"Cache-Control":"no-store"}})
  }catch{
    return Response.json({error:"Final approved timesheets are unavailable."},{status:503})
  }
}
export const GET=withOperationalCapture("/api/timesheets/final-approved","GET",getFinalApprovedTimesheets)
