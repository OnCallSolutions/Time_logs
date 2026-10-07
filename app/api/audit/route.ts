/**
 * Provides administrator-only access to recent security audit events.
 *
 * Audit records include who performed sensitive actions, what target was changed,
 * request context, and sanitized metadata. The route is read-only and restricted
 * to admins to preserve confidentiality of the security timeline.
 */
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { listAuditEvents } from "@/lib/db"

export const runtime = "nodejs"

/**
 * Returns recent audit events for administrator review.
 *
 * The optional limit query parameter is clamped inside the database helper, which
 * keeps the endpoint available even if a caller requests an excessive number of
 * events.
 *
 * @param req - Incoming request with optional limit query parameter.
 * @returns JSON response containing recent audit events or an error.
 */
export async function GET(req: Request) {
  try {
    const session = await auth()
    const email = session?.user?.email ?? null
    const role = await getEffectiveUserRole(email)

    if (role !== "admin") {
      return Response.json({ error: "Forbidden." }, { status: 403 })
    }

    const url = new URL(req.url)
    const limit = Number(url.searchParams.get("limit") ?? "100")
    const events = await listAuditEvents(Number.isFinite(limit) ? limit : 100)

    return Response.json({ events })
  } catch (err) {
    console.error("[audit] list failed:", err)
    return Response.json(
      { error: "Failed to load audit events." },
      { status: 500 },
    )
  }
}
