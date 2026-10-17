/**
 * Exposes admin-granted contractor handoff and assigned account-review queues.
 * Authenticated identity and live database roles govern every operation.
 * This endpoint does not calculate, authorize, or transfer funds.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { actorRoster } from "@/lib/collaboration"
import { getTimeEntry,listTimeEntries,listTimesheetPeriods,recordAuditEvent } from "@/lib/db"
import { createHandoffs,listHandoffs,reviewHandoff,accountTriageStates,actOnHandoffs } from "@/lib/account-handoffs"
import { getAuditContext } from "@/lib/audit"
import { listAccountIdentities } from "@/lib/account-identities"
import { z } from "zod"

/** @returns Authorized assignees or a scoped business-account queue. */
export async function GET(){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Forbidden."},{status:403})
    const canRead=(access.role==="account_manager"||access.role==="admin")&&access.permissions.view_accounts
    if(!canRead)return Response.json({error:"Business-accounts dashboard is restricted to administrators and business accounts managers."},{status:403})
    const managers=(await actorRoster()).filter(user=>user.role==="manager"&&user.accessStatus==="active").map(user=>({email:user.email,officialName:user.displayName}))
    return Response.json({candidates:[],assignees:[],managers,periods:await listTimesheetPeriods(),handoffs:await listHandoffs(email,true)},{headers:{"Cache-Control":"no-store"}})
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
    const identities=await listAccountIdentities()
    if(await getEffectiveUserRole(input.recipient)!=="account_manager")return Response.json({error:"Choose an active account manager."},{status:400})
    for(const id of ids){
      const entry=await getTimeEntry(email,id,access.permissions.view_team)
      const category=entry?.ownerEmail?await getEffectiveUserRole(entry.ownerEmail):null
      if(!entry||entry.status!=="approved"||!identities.some(identity=>identity.email===entry.ownerEmail?.toLowerCase())||!(category==="contractor"||category==="employee"))return Response.json({error:"Only approved records owned by a registered contractor or employee can be handed off."},{status:409})
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
    const input=z.union([
      z.object({id:z.string().uuid(),state:z.enum(accountTriageStates),note:z.string().trim().min(1).max(500),version:z.number().int().min(0)}),
      z.object({action:z.enum(["return_manager","return_submitter","authorize_eligibility"]),selection:z.array(z.object({id:z.string().uuid(),version:z.number().int().min(0)})).min(1).max(100),note:z.string().trim().min(1).max(500),manager:z.string().email().optional(),checks:z.object({accuracy:z.boolean(),compliance:z.boolean(),housekeeping:z.boolean()}).default({accuracy:false,compliance:false,housekeeping:false})}),
    ]).parse(await req.json())
    if("action" in input){
      if(new Set(input.selection.map(row=>row.id)).size!==input.selection.length)return Response.json({error:"Select each timesheet once."},{status:400})
      if(input.action==="authorize_eligibility"&&(!access.permissions.authorize_payouts||!input.checks.accuracy||!input.checks.compliance||!input.checks.housekeeping))return Response.json({error:"Eligibility authorization requires its explicit right and all three review checks."},{status:403})
      const visible=await listHandoffs(email,true)
      if(input.selection.some(selected=>!visible.some(row=>row.id===selected.id)))return Response.json({error:"Selection is outside the loaded business-accounts queue."},{status:403})
      if(input.action==="return_manager"){
        if(!input.manager)return Response.json({error:"Choose the receiving manager."},{status:400})
        const recipient=await getEffectivePermissions(input.manager)
        if(recipient.role!=="manager"||!recipient.permissions.review_entries)return Response.json({error:"Choose an active manager with approval rights."},{status:403})
        for(const selected of input.selection){const row=visible.find(row=>row.id===selected.id)!;if(row.evidence.ownerEmail.toLowerCase()===input.manager.toLowerCase())return Response.json({error:"A manager cannot receive their own timesheet for approval."},{status:403});if(await getEffectiveUserRole(row.evidence.ownerEmail)==="manager"&&(!recipient.permissions.view_manager_entries||!recipient.permissions.review_manager_entries))return Response.json({error:"That manager needs explicit rights to review another manager's own time."},{status:403})}
      }
      const count=await actOnHandoffs(input.selection,email,input.action,input.note,input.checks,input.manager??null,getAuditContext(req))
      if(count!==input.selection.length)return Response.json({error:"One or more records changed or are locked. No selected records were changed."},{status:409})
      return Response.json({count,action:input.action,eligibilityOnly:true})
    }
    const updated=await reviewHandoff(input.id,email,true,input.state,input.note,input.version)
    if(!updated)return Response.json({error:"Evidence changed, review was updated, or this handoff is outside your scope. Refresh before retrying."},{status:409})
    await recordAuditEvent({actorEmail:email,action:"account_handoff_reviewed",targetType:"account_handoff",targetId:input.id,metadata:{state:input.state,note:input.note},...getAuditContext(req)})
    return Response.json({updated})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid account review.":"Account review unavailable."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:500})}
}
