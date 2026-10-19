import { z } from "zod"
import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { persistenceFailureDetails } from "@/lib/persistence-diagnostics"
import { createTimesheetExtensionRequest, listTimesheetExtensionRequests, listTimesheetPeriods } from "@/lib/db"
import { resolveAccountManagerReviewer, resolvePatronManager } from "@/lib/submission-reviewer"

export const runtime="nodejs"

async function getSubmissionExtensions(){
  try{
    const email=(await auth())?.user?.email
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    const reviewer=(access.role==="account_manager"||access.role==="manager")&&access.permissions.review_entries
    return Response.json({requests:await listTimesheetExtensionRequests(email,reviewer,access.role==="admin")},{headers:{"Cache-Control":"no-store"}})
  }catch(error){
    console.error("[submission-extensions] list failed",persistenceFailureDetails(error))
    return Response.json({error:"Extension requests could not be loaded."},{status:503})
  }
}

async function createSubmissionExtension(request:Request){
  try{
    const email=(await auth())?.user?.email
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if(!["employee","contractor","manager"].includes(access.role)||!access.permissions.submit_entries)return Response.json({error:"Only employees, contractors, or managers with submission access can request an extension."},{status:403})
    const input=z.object({periodId:z.string().uuid(),reason:z.string().trim().min(5).max(1000),requestedUntil:z.string().datetime({offset:true})}).strict().parse(await request.json())
    const until=Date.parse(input.requestedUntil)
    const period=(await listTimesheetPeriods()).find(candidate=>candidate.id===input.periodId)
    if(!period)return Response.json({error:"Select a configured timesheet period."},{status:400})
    const requesterDeadline=access.role==="manager"?period.managerSubmissionDeadline:period.submissionDeadline
    const hardCap=access.role==="manager"?period.accountApprovalDeadline:period.managerSubmissionDeadline
    if(!requesterDeadline||!hardCap)return Response.json({error:"This period does not have the required manager and account-review deadlines configured."},{status:409})
    const base=Date.parse(requesterDeadline),cap=Date.parse(hardCap)
    if(until<=Date.now()||until<=base||until>cap)return Response.json({error:`The requested deadline must be after ${new Date(base).toLocaleString()} and no later than ${new Date(cap).toLocaleString()}.`},{status:400})
    const reviewer=access.role==="manager"?await resolveAccountManagerReviewer(email):await resolvePatronManager(email)
    if(!reviewer)return Response.json({error:access.role==="manager"?"No active account manager is available to review your extension request. Contact your administrator.":"No active assigned manager is available to review this extension request. Contact your administrator."},{status:409})
    const created=await createTimesheetExtensionRequest({ownerEmail:email,periodId:input.periodId,assignedTo:reviewer.email,reason:input.reason,requestedUntil:input.requestedUntil,notBeforeUntil:new Date(base).toISOString(),hardCapUntil:new Date(cap).toISOString()},getAuditContext(request))
    if(!created)return Response.json({error:"No eligible draft or returned timesheets were found for that period, or a request is already pending."},{status:409})
    return Response.json({request:created},{status:201,headers:{"Cache-Control":"no-store"}})
  }catch(error){
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    if(!invalid)console.error("[submission-extensions] create failed",persistenceFailureDetails(error))
    return Response.json({error:invalid?"Enter a valid period, reason, and extension deadline.":"Extension request could not be saved."},{status:invalid?400:503})
  }
}

export const GET=withOperationalCapture("/api/submission-extensions","GET",getSubmissionExtensions)
export const POST=withOperationalCapture("/api/submission-extensions","POST",createSubmissionExtension)
