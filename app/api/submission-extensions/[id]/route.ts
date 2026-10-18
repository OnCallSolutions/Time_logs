import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { persistenceFailureDetails } from "@/lib/persistence-diagnostics"
import { decideTimesheetExtensionRequest } from "@/lib/db"

export const runtime="nodejs"

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const email=(await auth())?.user?.email
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if(access.role!=="account_manager"||!access.permissions.review_entries)return Response.json({error:"Only an authorized account manager can decide extension requests."},{status:403})
    const {id}=await params
    const input=z.object({decision:z.enum(["approved","denied"]),managerNote:z.string().trim().max(500).default("")}).strict().parse(await request.json())
    const saved=await decideTimesheetExtensionRequest(id,email,input.decision,input.managerNote,getAuditContext(request))
    if(!saved)return Response.json({error:"This request is no longer pending or is assigned to another reviewer. Refresh the queue."},{status:409})
    return Response.json({request:saved},{headers:{"Cache-Control":"no-store"}})
  }catch(error){
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    if(!invalid)console.error("[submission-extensions] decision failed",persistenceFailureDetails(error))
    return Response.json({error:invalid?"Enter a valid decision and note.":"The extension decision could not be saved."},{status:invalid?400:503})
  }
}
