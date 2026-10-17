/**
 * Provides administrator-only access to recent security audit events.
 *
 * Audit records include who performed sensitive actions, what target was changed,
 * request context, and sanitized metadata. The route is read-only and restricted
 * to admins to preserve confidentiality of the security timeline.
 */
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { listAuditEventPage } from "@/lib/db"

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
    const beforeAt=url.searchParams.get("beforeAt")??undefined
    const beforeId=url.searchParams.get("beforeId")??undefined
    if(Boolean(beforeAt)!==Boolean(beforeId)||beforeAt&&(!Number.isFinite(Date.parse(beforeAt))||!beforeId||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId)))return Response.json({error:"Invalid audit cursor."},{status:400})
    if(beforeAt){
      const page=await listAuditEventPage({limit:Number.isFinite(limit)?limit:250,beforeAt,beforeId})
      return Response.json(page,{headers:{"Cache-Control":"no-store"}})
    }
    const page=await listAuditEventPage({limit:Number.isFinite(limit)?limit:250})
    return Response.json(page,{headers:{"Cache-Control":"no-store"}})
  } catch (err) {
    console.error("[audit] list failed")
    return Response.json(
      { error: "Failed to load audit events." },
      { status: 500 },
    )
  }
}
