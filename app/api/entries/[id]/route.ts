/**
 * Handles item-level time entry API requests with owner and role checks.
 *
 * These handlers update or delete one entry at a time. Authorization is derived
 * from the signed-in email and role, then forwarded to the database helpers so
 * row ownership is checked in SQL.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import {
  auditActionForStatus,
  changedFieldMetadata,
  getAuditContext,
} from "@/lib/audit"
import {
  deleteTimeEntry,
  getTimeEntry,
  recordAuditEvent,
  updateTimeEntry,
} from "@/lib/db"
import type { EntryStatus, TimeEntry } from "@/lib/types"

export const runtime = "nodejs"

const patchSchema = z
  .object({
    contractor: z.string().trim().min(1).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    hours: z.number().min(0).optional(),
    project: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(["draft", "submitted", "approved", "rejected"]).optional(),
    reviewNote: z.string().trim().max(500).optional(),
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
  const {role,permissions} = await getEffectivePermissions(email)

  if (!email || !role) {
    return null
  }

  return {
    email,
    role,
    includeAll: permissions.view_team,
    canReview: permissions.review_entries,
    permissions,
  }
}

/**
 * Checks whether a patch changes editable time-entry fields.
 *
 * Status changes are handled separately because they follow workflow transition
 * rules. Core field edits are locked for employees once an entry is submitted or
 * approved.
 *
 * @param patch - Parsed entry patch from the request body.
 * @returns True when the patch changes core entry data.
 */
function hasEntryFieldPatch(patch: z.infer<typeof patchSchema>) {
  return (
    patch.contractor !== undefined ||
    patch.date !== undefined ||
    patch.hours !== undefined ||
    patch.project !== undefined ||
    patch.description !== undefined
  )
}

/**
 * Validates a requested status change against current entry state.
 *
 * Managers and administrators can make every approval decision. Employees and base
 * users can submit drafts or rejected rows, and recall submitted rows back to
 * draft. Rejections require a manager/admin-provided reason.
 *
 * @param current - Current database-backed entry state.
 * @param status - Requested entry status, if the patch includes one.
 * @param canReview - Whether the caller is a manager or administrator.
 * @param reviewNote - Optional rejection reason supplied by the reviewer.
 * @returns Null when allowed, otherwise a user-facing validation message.
 */
function validateStatusChange(
  current: TimeEntry,
  status: EntryStatus | undefined,
  canReview: boolean,
  reviewNote?: string,
) {
  if (!status || status === current.status) return null

  if (status === "rejected" && !reviewNote?.trim()) {
    return "A rejection reason is required."
  }

  if (canReview) {
    if (
      current.status === "submitted" &&
      (status === "approved" || status === "rejected" || status === "draft")
    ) {
      return null
    }

    if (
      (current.status === "draft" || current.status === "rejected") &&
      status === "submitted"
    ) {
      return null
    }

    if (
      (current.status === "approved" || current.status === "rejected") &&
      status === "draft"
    ) {
      return null
    }

    return `Cannot move an entry from ${current.status} to ${status}.`
  }

  if (
    (current.status === "draft" || current.status === "rejected") &&
    status === "submitted"
  ) {
    return null
  }

  if (current.status === "submitted" && status === "draft") {
    return null
  }

  return "You do not have permission to set that status."
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
    if ((hasEntryFieldPatch(patch) && !access.permissions.edit_entries) ||
      ((patch.status === "approved" || patch.status === "rejected") && !access.permissions.review_entries) ||
      ((patch.status === "draft" || patch.status === "submitted") && !access.permissions.submit_entries && !access.permissions.review_entries))
      return Response.json({error:"Forbidden."},{status:403})
    if (patch.reviewNote !== undefined && patch.status !== "rejected" && patch.status !== "approved") {
      return Response.json(
        { error: "A review note can only be saved when rejecting an entry." },
        { status: 400 },
      )
    }

    const current = await getTimeEntry(access.email, id, access.includeAll)

    if (!current) {
      return Response.json({ error: "Entry not found." }, { status: 404 })
    }

    if (
      !access.canReview &&
      hasEntryFieldPatch(patch) &&
      current.status !== "draft" &&
      current.status !== "rejected"
    ) {
      return Response.json(
        {
          error:
            "Submitted and approved entries cannot be edited by employees.",
        },
        { status: 409 },
      )
    }

    const statusError = validateStatusChange(
      current,
      patch.status,
      access.canReview,
      patch.reviewNote,
    )
    if (statusError) {
      return Response.json(
        { error: statusError },
        { status: statusError.includes("permission") ? 403 : 400 },
      )
    }

    const entry = await updateTimeEntry(
      access.email,
      id,
      patch,
      access.includeAll,
      access.canReview ? access.email : undefined,
    )

    if (!entry) {
      return Response.json({ error: "Entry not found." }, { status: 404 })
    }

    await recordAuditEvent({
      actorEmail: access.email,
      action: patch.status
        ? auditActionForStatus(patch.status)
        : "entry_updated",
      targetType: "time_entry",
      targetId: id,
      metadata: {
        fromStatus: current.status,
        toStatus: entry.status,
        ...changedFieldMetadata(patch),
      },
      ...getAuditContext(req),
    })

    return Response.json({ entry })
  } catch (err) {
    console.error("[entries] update failed")
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
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }
    if (!access.permissions.delete_entries) return Response.json({error:"Forbidden."},{status:403})

    const { id } = await params
    const current = await getTimeEntry(access.email, id, access.includeAll)

    if (!current) {
      return Response.json({ error: "Entry not found." }, { status: 404 })
    }

    if (
      !access.canReview &&
      current.status !== "draft" &&
      current.status !== "rejected"
    ) {
      return Response.json(
        {
          error:
            "Submitted and approved entries cannot be deleted by employees.",
        },
        { status: 409 },
      )
    }

    await deleteTimeEntry(access.email, id, access.includeAll)
    await recordAuditEvent({
      actorEmail: access.email,
      action: "entry_deleted",
      targetType: "time_entry",
      targetId: id,
      metadata: {
        status: current.status,
        hours: current.hours,
        date: current.date,
      },
      ...getAuditContext(req),
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error("[entries] delete failed")
    return Response.json(
      { error: "Failed to delete entry." },
      { status: 500 },
    )
  }
}
