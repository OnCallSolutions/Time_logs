/**
 * Controls scheduled cutoff, suspension, and expiring operational assignments.
 * Administrators own offboarding; eligible managers grant only rights they hold.
 * Administrator accounts, financial rights, and Microsoft sessions are excluded.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole,getUserRole } from "@/lib/access"
import { getManagedAccessUser,recordAuditEvent } from "@/lib/db"
import { getAuditContext } from "@/lib/audit"
import { temporaryPermissions } from "@/lib/access-lifecycle-policy"
import { getAccountLifecycle,listAccessLifecycle,saveAccountLifecycle,createTemporaryAssignment,revokeTemporaryAssignment,getTemporaryAssignment,extendTemporaryAssignment } from "@/lib/access-lifecycle-store"
import { z } from "zod"
const reason=z.string().trim().min(1).max(500)
const email=z.string().email().transform(value=>value.toLowerCase())
const timestamp=z.string().datetime({offset:true})
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("schedule_cutoff"),email,cutoffAt:timestamp,reason}),
  z.object({action:z.literal("cancel_cutoff"),email,reason}),
  z.object({action:z.literal("suspend"),email,reviewAt:timestamp,reason}),
  z.object({action:z.literal("reactivate"),email,reason}),
  z.object({action:z.literal("grant"),email,permissions:z.array(z.enum(temporaryPermissions)).min(1).max(7),scope:z.enum(["own","all"]),startsAt:timestamp,endsAt:timestamp,reason}),
  z.object({action:z.literal("revoke"),id:z.string().uuid(),reason}),
  z.object({action:z.literal("extend"),id:z.string().uuid(),endsAt:timestamp,reason}),
])

/** @returns Promise<Response> containing bounded operator-authorized lifecycle records. */
export async function GET(){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!(access.role==="admin"||(access.role==="manager"&&access.permissions.delegate_permissions)))return Response.json({error:"Forbidden."},{status:403})
    return Response.json(await listAccessLifecycle(email,access.role==="admin"),{headers:{"Cache-Control":"no-store"}})
  }catch{return Response.json({error:"Access lifecycle unavailable."},{status:500})}
}

/** @param req - Explicit action, time boundaries, and required operator reason. @returns Confirmed lifecycle mutation or safe authorization failure. */
export async function POST(req:Request){
  try{
    const actor=(await auth())?.user?.email;const access=await getEffectivePermissions(actor)
    if(!actor||!(access.role==="admin"||(access.role==="manager"&&access.permissions.delegate_permissions)))return Response.json({error:"Forbidden."},{status:403})
    const input=schema.parse(await req.json());const admin=access.role==="admin"
    if(input.action==="extend"){
      const grant=await getTemporaryAssignment(input.id)
      if(!grant||grant.revokedAt||(!admin&&grant.grantedBy!==actor.toLowerCase()))return Response.json({error:"Assignment unavailable or not granted by you."},{status:409})
      const role=await getEffectiveUserRole(grant.email)
      if(!(role==="employee"||role==="contractor"||role==="manager")||(!admin&&role==="manager"))return Response.json({error:"Choose an active eligible operational account."},{status:403})
      if(Date.parse(input.endsAt)<=Date.parse(grant.endsAt)||Date.parse(input.endsAt)<=Date.now())return Response.json({error:"The extension must be later than the existing expiry and current time."},{status:400})
      if(!admin&&grant.permissions.some(key=>!access.permissions[key]))return Response.json({error:"You no longer hold the assigned rights."},{status:403})
      if(!await extendTemporaryAssignment(input.id,input.endsAt,actor,admin,input.reason))return Response.json({error:"Assignment changed; refresh and retry."},{status:409})
      await recordAuditEvent({actorEmail:actor,action:"temporary_assignment_extended",targetType:"temporary_assignment",targetId:input.id,metadata:{previousExpiry:grant.endsAt,endsAt:input.endsAt,reason:input.reason},...getAuditContext(req)})
      return Response.json({ok:true})
    }
    if(input.action==="revoke"){
      if(!await revokeTemporaryAssignment(input.id,actor,admin))return Response.json({error:"Assignment unavailable or not granted by you."},{status:409})
      await recordAuditEvent({actorEmail:actor,action:"temporary_assignment_revoked",targetType:"temporary_assignment",targetId:input.id,metadata:{reason:input.reason},...getAuditContext(req)})
      return Response.json({ok:true})
    }
    const managed=await getManagedAccessUser(input.email)
    if(getUserRole(input.email)==="admin"||managed?.role==="admin")return Response.json({error:"Administrator lifecycle changes require the existing protected admin role workflow."},{status:409})
    if(input.action==="grant"){
      const role=await getEffectiveUserRole(input.email)
      if(!(role==="employee"||role==="contractor"||role==="manager"))return Response.json({error:"Choose an active operational account."},{status:400})
      if(!admin&&role==="manager")return Response.json({error:"Managers cannot assign duties to other managers."},{status:403})
      if(Date.parse(input.endsAt)<=Date.parse(input.startsAt)||Date.parse(input.endsAt)<=Date.now())return Response.json({error:"Assignments need a future expiry after their start."},{status:400})
      if(input.scope==="own"&&input.permissions.some(key=>!["create_entries","edit_entries","delete_entries","submit_entries"].includes(key)))return Response.json({error:"Review and reporting rights require explicit whole-application scope."},{status:400})
      if(input.permissions.some(key=>managed?.permissions?.[key]===false))return Response.json({error:"An explicit administrator denial overrides this assignment."},{status:409})
      if(!admin&&input.permissions.some(key=>!access.permissions[key]))return Response.json({error:"Managers may grant only rights they currently hold."},{status:403})
      const id=await createTemporaryAssignment({...input,permissions:[...new Set(input.permissions)],grantedBy:actor})
      await recordAuditEvent({actorEmail:actor,action:"temporary_assignment_created",targetType:"temporary_assignment",targetId:id,metadata:{email:input.email,scope:input.scope,permissions:input.permissions,startsAt:input.startsAt,endsAt:input.endsAt,reason:input.reason},...getAuditContext(req)})
      return Response.json({id},{status:201})
    }
    if(!admin)return Response.json({error:"Only administrators may change account lifecycle."},{status:403})
    const current=await getAccountLifecycle(input.email)
    if((input.action==="schedule_cutoff"||input.action==="cancel_cutoff")&&current?.cutoffAt&&Date.parse(current.cutoffAt)<=Date.now())return Response.json({error:"The cutoff is already effective. Use explicit reactivation before scheduling new access."},{status:409})
    const next={email:input.email,cutoffAt:current?.cutoffAt??null,suspended:current?.suspended??false,reviewAt:current?.reviewAt??null,reason:input.reason,updatedBy:actor}
    if(input.action==="schedule_cutoff")next.cutoffAt=input.cutoffAt
    if(input.action==="cancel_cutoff")next.cutoffAt=null
    if(input.action==="suspend"){if(Date.parse(input.reviewAt)<=Date.now())return Response.json({error:"Choose a future suspension review date."},{status:400});next.suspended=true;next.reviewAt=input.reviewAt}
    if(input.action==="reactivate"){next.suspended=false;next.cutoffAt=null;next.reviewAt=null}
    await saveAccountLifecycle(next,input.action)
    await recordAuditEvent({actorEmail:actor,action:"account_lifecycle_updated",targetType:"account_lifecycle",targetId:input.email,metadata:{operation:input.action,cutoffAt:next.cutoffAt,suspended:next.suspended,reviewAt:next.reviewAt,reason:input.reason},...getAuditContext(req)})
    return Response.json({ok:true})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid lifecycle settings.":"Lifecycle update unavailable."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:500})}
}
