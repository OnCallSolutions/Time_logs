import { z } from "zod"
import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { persistenceFailureDetails } from "@/lib/persistence-diagnostics"
import { decideTimesheetExtensionRequest } from "@/lib/db"
import { recordAuditEvent } from "@/lib/db"

export const runtime="nodejs"

async function decideSubmissionExtension(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const email=(await auth())?.user?.email
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    const isAdmin=access.role==="admin"
    if(!isAdmin&&(!(access.role==="manager"||access.role==="account_manager")||!access.permissions.review_entries))return Response.json({error:"Extension review permission is required."},{status:403})
    const {id}=await params
    const input=z.object({decision:z.enum(["approved","denied"]),managerNote:z.string().trim().min(5).max(500),approvedUntil:z.string().datetime({offset:true}).nullable().optional()}).strict().parse(await request.json())
    if(input.decision==="approved"&&!input.approvedUntil)return Response.json({error:"Choose the approved deadline."},{status:400})
    const saved=await decideTimesheetExtensionRequest(id,email,input.decision,input.managerNote,input.decision==="approved"?input.approvedUntil!:null,isAdmin,getAuditContext(request))
    if(!saved)return Response.json({error:"This request is no longer pending or is assigned to another reviewer. Refresh the queue."},{status:409})
    if(isAdmin)await recordAuditEvent({actorEmail:email,action:"admin_extension_override",targetType:"timesheet_extension_request",targetId:id,metadata:{decision:input.decision,reason:input.managerNote,approvedUntil:input.approvedUntil??null},...getAuditContext(request)})
    return Response.json({request:saved},{headers:{"Cache-Control":"no-store"}})
  }catch(error){
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    if(!invalid)console.error("[submission-extensions] decision failed",persistenceFailureDetails(error))
    return Response.json({error:invalid?"Enter a valid decision and note.":"The extension decision could not be saved."},{status:invalid?400:503})
  }
}

export const PATCH=withOperationalCapture("/api/submission-extensions/[id]","PATCH",decideSubmissionExtension)
