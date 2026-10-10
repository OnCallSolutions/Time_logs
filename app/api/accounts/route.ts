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
import { createHandoffs,listHandoffs,reviewHandoff,accountReviewStates } from "@/lib/account-handoffs"
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
    if(canSend){for(const entry of (await listTimeEntries(email,access.permissions.view_team)).filter(entry=>entry.status==="approved").slice(0,100)){if(entry.ownerEmail){const category=await getEffectiveUserRole(entry.ownerEmail);if(category==="contractor"||category==="employee")candidates.push({...entry,workerCategory:category})}}}
    return Response.json({candidates,assignees:canSend?(await actorRoster()).filter(user=>user.role==="account_manager"&&user.accessStatus==="active").map(user=>({email:user.email})):[],handoffs:canRead?await listHandoffs(email,access.role==="admin"):canSend?await listHandoffs(email,false,true):[]},{headers:{"Cache-Control":"no-store"}})
  }catch{return Response.json({error:"Business-account queue unavailable."},{status:500})}
}

/** @param req - Explicit selected entry IDs and account-manager assignment. @returns Confirmed handoffs or scoped validation errors. */
export async function POST(req:Request){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!(access.role==="manager"||access.role==="admin")||!access.permissions.send_to_accounts)return Response.json({error:"Forbidden."},{status:403})
    const input=z.object({ids:z.array(z.string().uuid()).min(1).max(50),recipient:z.string().email()}).parse(await req.json())
    const ids=[...new Set(input.ids)]
    const categories:Record<string,"contractor"|"employee">={}
    if(await getEffectiveUserRole(input.recipient)!=="account_manager")return Response.json({error:"Choose an active account manager."},{status:400})
    for(const id of ids){
      const entry=await getTimeEntry(email,id,access.permissions.view_team)
      const category=entry?.ownerEmail?await getEffectiveUserRole(entry.ownerEmail):null
      if(!entry||entry.status!=="approved"||!(category==="contractor"||category==="employee"))return Response.json({error:"Only visible approved contractor or internal employee records can be handed off."},{status:409})
      categories[id]=category
    }
    const handoffs=await createHandoffs(ids,email,input.recipient,access.permissions.view_team,categories)
    await recordAuditEvent({actorEmail:email,action:"account_handoff_created",targetType:"account_handoff",metadata:{requestedCount:ids.length,createdCount:handoffs.length,assignedTo:input.recipient.toLowerCase()},...getAuditContext(req)})
    return Response.json({handoffs,createdCount:handoffs.length,requestedCount:ids.length},{status:201})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid handoff selection.":"Handoff unavailable."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:500})}
}

/** @param req - Explicit scoped triage action and expected review version. @returns Confirmed review state or a concurrency/authorization failure. */
export async function PATCH(req:Request){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!(access.role==="account_manager"||access.role==="admin")||!access.permissions.view_accounts||!access.permissions.review_accounts)return Response.json({error:"Account review rights are required."},{status:403})
    const input=z.object({id:z.string().uuid(),state:z.enum(accountReviewStates),note:z.string().trim().min(1).max(500),version:z.number().int().min(0)}).parse(await req.json())
    const updated=await reviewHandoff(input.id,email,access.role==="admin",input.state,input.note,input.version)
    if(!updated)return Response.json({error:"Evidence changed, review was updated, or this handoff is outside your scope. Refresh before retrying."},{status:409})
    await recordAuditEvent({actorEmail:email,action:"account_handoff_reviewed",targetType:"account_handoff",targetId:input.id,metadata:{state:input.state,note:input.note},...getAuditContext(req)})
    return Response.json({updated})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid account review.":"Account review unavailable."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:500})}
}
