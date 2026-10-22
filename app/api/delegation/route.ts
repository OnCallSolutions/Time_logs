/**
 * Allows authorized managers to delegate held workflow rights to employees.
 * Delegation cannot change account roles, unblock accounts, or grant admin powers.
 * All writes require explicit save and are recorded in the existing audit trail.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { delegateEmployeePermissions,recordAuditEvent } from "@/lib/db"
import { actorRoster,employeeRoster } from "@/lib/collaboration"
import { permissionLabels, delegablePermissions, type Permission } from "@/lib/permissions"
import { getAuditContext } from "@/lib/audit"
import { z } from "zod"
import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { emailSchema } from "@/lib/identity-policy"
import { ensureAccountIdentitiesForActors } from "@/lib/account-identities"
/**
 * Returns all actor identities to authorized delegators without expanding edits.
 * Managers still modify only active employee workflow rights through PATCH.
 * @returns Promise<Response> with actor summaries or a forbidden response.
 */
async function getDelegatedRights(): Promise<Response> {
  const email = (await auth())?.user?.email
  const access = await getEffectivePermissions(email)
  if (!email || !(access.role === "admin" || access.role === "manager") ||
      (!access.permissions.delegate_permissions && !access.permissions.send_messages)) return Response.json({error:"Forbidden."},{status:403})
  const roster=await actorRoster(), identities=await ensureAccountIdentitiesForActors(roster.map(user=>user.email),email)
  const users = await Promise.all(roster.map(async user=>{const identity=identities.find(identity=>identity.email===user.email.toLowerCase());return {...user,displayName:identity?.officialName??"",companyReference:identity?.shortReference,contractorNumber:identity?.contractorNumber,employeeId:identity?.employeeId,permissions:(await getEffectivePermissions(user.email)).permissions}}))
  return Response.json({users},{headers:{"Cache-Control":"no-store"}})
}
/**
 * Saves employee control rights within the authenticated delegator's authority.
 * @param req - Request with target employee email and explicit permission changes.
 * @returns Promise<Response> with saved rights or a safe error.
 */
async function updateDelegatedRights(req:Request): Promise<Response> {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !(access.role === "manager" || access.role === "admin") || !access.permissions.delegate_permissions) return Response.json({error:"Forbidden."},{status:403})
    const body = z.object({email:emailSchema,permissions:z.record(z.string(),z.boolean())}).parse(await req.json())
    const target = (await employeeRoster()).find(user=>user.email.toLowerCase() === body.email.toLowerCase())
    if (!target) return Response.json({error:"Select an active employee."},{status:400})
    for(const [key,value] of Object.entries(body.permissions)) {
      if (!Object.hasOwn(permissionLabels,key) || !delegablePermissions.includes(key as Permission) || (value && !access.permissions[key as Permission]))
        return Response.json({error:"You cannot delegate this right."},{status:403})
    }
    const changedPermissions=Object.keys(body.permissions)
    const before=(await getEffectivePermissions(target.email)).permissions
    const user = await delegateEmployeePermissions(target.email,target.role as "employee"|"contractor",body.permissions,email)
    const after=(await getEffectivePermissions(target.email)).permissions
    await recordAuditEvent({actorEmail:email,action:"user_access_updated",targetType:"managed_user_access",targetId:target.email,metadata:{changedPermissions,delegated:true,beforePermissions:Object.fromEntries(changedPermissions.map(key=>[key,before[key as keyof typeof before]])),afterPermissions:Object.fromEntries(changedPermissions.map(key=>[key,after[key as keyof typeof after]]))},...getAuditContext(req)})
    return Response.json({user})
  } catch { return Response.json({error:"Unable to save delegated rights."},{status:400}) }
}
export const GET=withOperationalCapture("/api/delegation","GET",getDelegatedRights)
export const PATCH=withOperationalCapture("/api/delegation","PATCH",updateDelegatedRights)
