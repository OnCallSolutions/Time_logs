/**
 * Handles collection-level time entry API requests with role-aware visibility.
 *
 * GET returns the entries a caller is allowed to see, POST creates entries owned
 * by the caller, and DELETE clears the caller's visible scope. All handlers share
 * the same access resolver so UI navigation and backend permissions stay aligned.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { canReviewRole } from "@/lib/review-policy"
import { createReviewAccess } from "@/lib/review-access"
import { listAccountIdentities } from "@/lib/account-identities"
import { ensureAccountHandoffStorage } from "@/lib/account-handoffs"
import { isAppSessionFresh } from "@/lib/app-sessions"
import { getAuditContext } from "@/lib/audit"
import {
  clearTimeEntries,
  createTimeEntries,
  listTimeEntries,
  recordAuditEvent,
} from "@/lib/db"

export const runtime = "nodejs"

const entrySchema = z.object({
  contractor: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().min(0),
  project: z.string().trim().min(1).default("General"),
  description: z.string().default(""),
})

const createSchema = z.object({
  entries: z.array(entrySchema).min(1),
})

/**
 * Reads the signed-in user's email and role-derived data visibility.
 *
 * The returned includeAll flag is true only for managers and administrators. API
 * handlers pass this flag to the database layer so owner scoping is enforced by
 * the SQL statement instead of trusting client-side navigation. Entry-level
 * rights checks run in bounded batches to avoid serial database round trips.
 *
 * @returns Access metadata for the signed-in user, or null when unauthorized.
 */
async function getAccess() {
  const session = await auth()
  const email = session?.user?.email ?? null
  const {role,permissions} = await getEffectivePermissions(email)

  if (!email || !role) {
    return null
  }

  return {
    email,
    appSessionId:session?.appSessionId,
    role,
    includeAll: role==="manager"||permissions.view_team||(role==="account_manager"&&permissions.view_manager_entries),
    permissions,
  }
}

/**
 * Returns the entries visible to the signed-in user's role.
 *
 * Employees and base users receive only entries owned by their email. Managers and
 * administrators receive all entries so the team report can aggregate across the
 * organization.
 *
 * @returns JSON response containing visible entries or an error.
 */
export async function GET() {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    let entries = await listTimeEntries(access.email, access.includeAll)
    const resolve = createReviewAccess(access.email, access)
    const eligible=[]
    for(let offset=0;offset<entries.length;offset+=50){
      const batch=entries.slice(offset,offset+50)
      const scopes=await Promise.all(batch.map(entry=>resolve(entry)))
      for(let index=0;index<batch.length;index++){
        const entry=batch[index],scope=scopes[index]
        if(scope.visible)eligible.push({...entry,reviewEligible:scope.reviewable,approvalEligible:scope.reviewable&&(access.role==="account_manager"||access.permissions.send_to_accounts)})
      }
    }
    const identities=await listAccountIdentities(eligible.flatMap(entry=>entry.ownerEmail?[entry.ownerEmail]:[]))
    const identityByEmail=new Map(identities.map(identity=>[identity.email,identity]))
    return Response.json({ entries:eligible.map(entry=>{
      const identity=entry.ownerEmail?identityByEmail.get(entry.ownerEmail.toLowerCase()):undefined
      return identity?{...entry,contractor:identity.officialName,contractorNumber:identity.contractorNumber,shortReference:identity.shortReference,companyCode:identity.companyCode,employeeId:identity.employeeId}:entry
    }) },{headers:{"Cache-Control":"no-store"}})
  } catch (err) {
    console.error("[entries] list failed")
    return Response.json(
      { error: "Failed to load saved entries." },
      { status: 500 },
    )
  }
}

/**
 * Creates entries owned by the signed-in user.
 *
 * The request body is validated before anything is inserted. Even elevated users
 * create records under their own email to keep ownership and audit behavior
 * predictable.
 *
 * @param req - Request containing parsed time entries in the JSON body.
 * @returns JSON response containing created entries or an error.
 */
export async function POST(req: Request) {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }
    if (!access.permissions.create_entries) return Response.json({error:"Forbidden."},{status:403})

    const body = createSchema.parse(await req.json())
    const identity=(await listAccountIdentities([access.email]))[0]
    const auditContext = getAuditContext(req)
    const entries = await createTimeEntries(access.email, body.entries.map(entry=>identity?{...entry,contractor:identity.officialName}:entry),identity?.contractorNumber,auditContext)

    return Response.json({ entries }, { status: 201 })
  } catch (err) {
    if(err instanceof z.ZodError||err instanceof SyntaxError)return Response.json({error:"Invalid time entries. Check dates, hours and project names."},{status:400})
    const reference=crypto.randomUUID()
    const databaseCode=err&&typeof err==="object"&&"code" in err&&typeof err.code==="string"&&/^[A-Z0-9]{5}$/.test(err.code)?err.code:"unavailable"
    console.error("[entries] create outcome unconfirmed",{reference,databaseCode})
    return Response.json({error:"The submission could not be confirmed. Refresh entries before retrying; some rows may already have saved.",reference},{status:503})
  }
}

/**
 * Clears the entries visible to the signed-in user's role.
 *
 * This route is intentionally role-sensitive: regular users clear their own data,
 * while managers and administrators clear the team-wide set visible to them. The
 * client only shows the bulk action to elevated roles.
 *
 * @returns JSON response confirming deletion or reporting an error.
 */
export async function DELETE(req: Request) {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }
    if (!access.permissions.delete_entries) return Response.json({error:"Forbidden."},{status:403})
    const input=z.object({scope:z.enum(["own_entries","all_entries"]).default("own_entries")}).strict().parse(await req.json().catch(()=>({})))
    if(input.scope==="all_entries"&&(access.role!=="admin"||!access.permissions.view_team))return Response.json({error:"Only an administrator can clear all organization timesheets."},{status:403})
    if(input.scope==="all_entries"&&(!access.appSessionId||!await isAppSessionFresh(access.appSessionId,access.email)))return Response.json({error:"Reauthenticate with Microsoft before clearing organization timesheets.",requiresReauthentication:true},{status:428})
    if(access.role==="manager"&&access.includeAll)return Response.json({error:"Managers must use individual authorized entry controls; hidden records cannot be bulk-cleared."},{status:403})
    if(input.scope==="all_entries")await ensureAccountHandoffStorage()
    const deletedCount=await clearTimeEntries(access.email,input.scope==="all_entries")
    await recordAuditEvent({
      actorEmail: access.email,
      action: "entries_cleared",
      targetType: "time_entries",
      targetId: null,
      metadata: { scope: input.scope,deletedCount,financeHandoffsPreserved:input.scope==="all_entries" },
      ...getAuditContext(req),
    })

    return Response.json({ ok: true,deletedCount })
  } catch (err) {
    console.error("[entries] clear failed")
    return Response.json(
      { error: "Failed to clear entries." },
      { status: 500 },
    )
  }
}
