/**
 * Exposes admin-granted contractor handoff and assigned account-review queues.
 * Authenticated identity and live database roles govern every operation.
 * This endpoint does not calculate, authorize, or transfer funds.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { actorRoster } from "@/lib/collaboration"
import { getTimeEntry,listTimeEntries,recordAuditEvent } from "@/lib/db"
import { createHandoffs,listHandoffs } from "@/lib/account-handoffs"
import { getAuditContext } from "@/lib/audit"
import { z } from "zod"

/** @returns Authorized assignees or a scoped business-account queue. */
export async function GET(){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Forbidden."},{status:403})
    const canSend=(access.role==="manager"||access.role==="admin")&&access.permissions.send_to_accounts
    const canRead=(access.role==="account_manager"||access.role==="admin")&&access.permissions.view_accounts
    if(!canSend&&!canRead)return Response.json({error:"Business-account rights are required."},{status:403})
    const candidates=[]
    if(canSend){for(const entry of (await listTimeEntries(email,access.permissions.view_team)).filter(entry=>entry.status==="approved").slice(0,100)){if(entry.ownerEmail&&await getEffectiveUserRole(entry.ownerEmail)==="contractor")candidates.push(entry)}}
    return Response.json({candidates,assignees:canSend?(await actorRoster()).filter(user=>user.role==="account_manager"&&user.accessStatus==="active").map(user=>({email:user.email})):[],handoffs:canRead?await listHandoffs(email,access.role==="admin"):[]},{headers:{"Cache-Control":"no-store"}})
  }catch{return Response.json({error:"Business-account queue unavailable."},{status:500})}
}

/** @param req - Explicit selected entry IDs and account-manager assignment. @returns Confirmed handoffs or scoped validation errors. */
export async function POST(req:Request){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!(access.role==="manager"||access.role==="admin")||!access.permissions.send_to_accounts)return Response.json({error:"Forbidden."},{status:403})
    const input=z.object({ids:z.array(z.string().uuid()).min(1).max(50),recipient:z.string().email()}).parse(await req.json())
    const ids=[...new Set(input.ids)]
    if(await getEffectiveUserRole(input.recipient)!=="account_manager")return Response.json({error:"Choose an active account manager."},{status:400})
    for(const id of ids){
      const entry=await getTimeEntry(email,id,access.permissions.view_team)
      if(!entry||entry.status!=="approved"||!entry.ownerEmail||await getEffectiveUserRole(entry.ownerEmail)!=="contractor")return Response.json({error:"Only visible approved contractor records can be handed off."},{status:409})
    }
    const handoffs=await createHandoffs(ids,email,input.recipient,access.permissions.view_team)
    await recordAuditEvent({actorEmail:email,action:"account_handoff_created",targetType:"account_handoff",metadata:{requestedCount:ids.length,createdCount:handoffs.length,assignedTo:input.recipient.toLowerCase()},...getAuditContext(req)})
    return Response.json({handoffs,createdCount:handoffs.length,requestedCount:ids.length},{status:201})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid handoff selection.":"Handoff unavailable."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:500})}
}
