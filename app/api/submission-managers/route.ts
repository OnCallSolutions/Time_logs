/**
 * Returns minimal active-manager choices for personal timesheet submission.
 * This does not expose the employee directory, rights, logs, or financial metadata.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { actorRoster } from "@/lib/collaboration"
import { listAccountIdentities } from "@/lib/account-identities"
/** @returns Promise<Response> with authenticated submission-manager choices only. */
export async function GET(): Promise<Response> {
  try {
    const email = (await auth())?.user?.email, access = await getEffectivePermissions(email)
    if (!email || !access.permissions.submit_entries || !access.role) return Response.json({ error: "Forbidden." }, { status: 403 })
    const managers=[]
    const roster=await actorRoster(),identities=await listAccountIdentities(roster.map(actor=>actor.email))
    for(const actor of roster){
      if(actor.role!=="manager"||actor.accessStatus!=="active"||actor.email.toLowerCase()===email.toLowerCase())continue
      const reviewer=await getEffectivePermissions(actor.email)
      if(reviewer.role==="manager"&&reviewer.permissions.review_entries&&reviewer.permissions.view_team)managers.push({email:actor.email,displayName:identities.find(identity=>identity.email===actor.email.toLowerCase())?.officialName??"Company account"})
    }
    return Response.json({ managers }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "Manager choices unavailable." }, { status: 503 }) }
}
