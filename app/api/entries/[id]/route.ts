/**
 * Handles item-level time entry API requests with owner and role checks.
 *
 * These handlers update or delete one entry at a time. Authorization is derived
 * from the signed-in email and role, then forwarded to the database helpers so
 * row ownership is checked in SQL.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { deleteTimeEntry, updateTimeEntry } from "@/lib/db"

export const runtime = "nodejs"

const patchSchema = z
  .object({
    contractor: z.string().trim().min(1).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    hours: z.number().min(0).optional(),
    project: z.string().trim().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one field is required.",
  })

/**
 * Reads the signed-in user's email and role-derived edit visibility.
 *
 * This helper mirrors the collection route access resolver. Keeping the logic
 * local to the route file makes each handler self-contained while still relying
 * on the shared role rules from lib/access.
 *
 * @returns Access metadata for the signed-in user, or null when unauthorized.
 */
async function getAccess() {
  const session = await auth()
  const email = session?.user?.email ?? null
  const role = getEffectiveUserRole(email)

  if (!email || !role) {
    return null
  }

  return {
    email,
    includeAll: role === "admin" || role === "manager",
  }
}

/**
 * Updates one visible entry for the signed-in user's role.
 *
 * The patch body may include any editable time entry fields, but must include at
 * least one valid field. A missing return row is treated as not found, which also
 * covers entries hidden by owner scoping.
 *
 * @param req - Request containing the entry patch in the JSON body.
 * @param context - Route context containing the entry id parameter.
 * @returns JSON response containing the updated entry or an error.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const { id } = await params
    const patch = patchSchema.parse(await req.json())
    const entry = await updateTimeEntry(
      access.email,
      id,
      patch,
      access.includeAll,
    )

    if (!entry) {
      return Response.json({ error: "Entry not found." }, { status: 404 })
    }

    return Response.json({ entry })
  } catch (err) {
    console.error("[entries] update failed:", err)
    return Response.json(
      { error: "Failed to update entry." },
      { status: 400 },
    )
  }
}

/**
 * Deletes one visible entry for the signed-in user's role.
 *
 * The database helper performs the owner or elevated-role check. This handler
 * only extracts the route id, rejects unauthenticated callers, and returns a
 * simple success payload after the delete completes.
 *
 * @param _req - Incoming request, unused by this handler.
 * @param context - Route context containing the entry id parameter.
 * @returns JSON response confirming deletion or reporting an error.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const { id } = await params
    await deleteTimeEntry(access.email, id, access.includeAll)
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[entries] delete failed:", err)
    return Response.json(
      { error: "Failed to delete entry." },
      { status: 500 },
    )
  }
}
