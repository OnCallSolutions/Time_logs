/**
 * Returns minimal active-manager choices for personal timesheet submission.
 * This does not expose the employee directory, rights, logs, or financial metadata.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { actorRoster } from "@/lib/collaboration"
/** @returns Promise<Response> with authenticated submission-manager choices only. */
export async function GET(): Promise<Response> {
  try {
    const email = (await auth())?.user?.email, access = await getEffectivePermissions(email)
    if (!email || !access.permissions.submit_entries || !access.role) return Response.json({ error: "Forbidden." }, { status: 403 })
    const managers = (await actorRoster()).filter(actor => actor.role === "manager" && actor.accessStatus === "active" && actor.email.toLowerCase() !== email.toLowerCase()).map(actor => ({ email: actor.email, displayName: actor.displayName }))
    return Response.json({ managers }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "Manager choices unavailable." }, { status: 503 }) }
}
