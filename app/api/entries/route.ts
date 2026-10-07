/**
 * Handles collection-level time entry API requests with role-aware visibility.
 *
 * GET returns the entries a caller is allowed to see, POST creates entries owned
 * by the caller, and DELETE clears the caller's visible scope. All handlers share
 * the same access resolver so UI navigation and backend permissions stay aligned.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
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
 * the SQL statement instead of trusting client-side navigation.
 *
 * @returns Access metadata for the signed-in user, or null when unauthorized.
 */
async function getAccess() {
  const session = await auth()
  const email = session?.user?.email ?? null
  const role = await getEffectiveUserRole(email)

  if (!email || !role) {
    return null
  }

  return {
    email,
    includeAll: role === "admin" || role === "manager",
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

    const entries = await listTimeEntries(access.email, access.includeAll)
    return Response.json({ entries })
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

    const body = createSchema.parse(await req.json())
    const entries = await createTimeEntries(access.email, body.entries)
    const auditContext = getAuditContext(req)

    await Promise.all(
      entries.map((entry) =>
        recordAuditEvent({
          actorEmail: access.email,
          action: "entry_created",
          targetType: "time_entry",
          targetId: entry.id,
          metadata: {
            status: entry.status,
            hours: entry.hours,
            date: entry.date,
          },
          ...auditContext,
        }),
      ),
    )

    return Response.json({ entries }, { status: 201 })
  } catch (err) {
    console.error("[entries] create failed")
    return Response.json(
      { error: "Failed to save entries." },
      { status: 400 },
    )
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

    await clearTimeEntries(access.email, access.includeAll)
    await recordAuditEvent({
      actorEmail: access.email,
      action: "entries_cleared",
      targetType: "time_entries",
      targetId: null,
      metadata: { scope: access.includeAll ? "all_visible" : "own_entries" },
      ...getAuditContext(req),
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error("[entries] clear failed")
    return Response.json(
      { error: "Failed to clear entries." },
      { status: 500 },
    )
  }
}
