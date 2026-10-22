/**
 * Returns minimal active-manager choices for personal timesheet submission.
 * This does not expose the employee directory, rights, logs, or financial metadata.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { resolveSubmissionReviewer } from "@/lib/submission-reviewer"
/** @returns Promise<Response> with authenticated submission-manager choices only. */
export async function GET(): Promise<Response> {
  try {
    const email = (await auth())?.user?.email, access = await getEffectivePermissions(email)
    if (!email || !access.permissions.submit_entries || !access.role) return Response.json({ error: "Forbidden." }, { status: 403 })
    const manager=await resolveSubmissionReviewer(email)
    return Response.json({ manager }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "Manager choices unavailable." }, { status: 503 }) }
}
