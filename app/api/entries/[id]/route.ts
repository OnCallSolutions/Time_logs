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
import { getEffectiveUserRole } from "@/lib/access"
import { canReviewRole } from "@/lib/review-policy"
import { createReviewAccess } from "@/lib/review-access"
import { approveAndForward } from "@/lib/account-handoffs"
import { listAccountIdentities } from "@/lib/account-identities"
import { resolveSubmissionReviewer } from "@/lib/submission-reviewer"
import {
  auditActionForStatus,
  changedFieldMetadata,
  getAuditContext,
} from "@/lib/audit"
import {
  deleteTimeEntry,
  getTimeEntry,
  recordAuditEvent,
  rejectSubmittedEntry,
  updateTimeEntryWithAudit,
  submitTimeEntryWithAudit,
  getTimesheetSubmissionDeadline,
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
    expectedRevision: z.string().min(1).max(100).optional(),
    reviewManagerEmail: z.string().email().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).some(key=>key!=="expectedRevision"), {
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
    includeAll: role==="manager"||permissions.view_team||(role==="account_manager"&&(permissions.view_manager_entries||permissions.review_entries)),
    canReview: permissions.review_entries||permissions.review_manager_entries,
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
    let patch = patchSchema.parse(await req.json())
    if ((hasEntryFieldPatch(patch) && !access.permissions.edit_entries) ||
      ((patch.status === "approved" || patch.status === "rejected") && !access.canReview) ||
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

    const scope = await createReviewAccess(access.email, access)(current)
    if(!scope.visible)return Response.json({error:"Entry not found."},{status:404})
    if(access.role!=="admin"&&current.ownerEmail?.toLowerCase()!==access.email.toLowerCase()&&!scope.reviewable)return Response.json({error:"View-only access does not permit changing this timesheet. Request review assistance or ask an administrator."},{status:403})
    if(patch.contractor!==undefined&&current.ownerEmail){
      const identity=(await listAccountIdentities([current.ownerEmail]))[0]
      if(identity&&patch.contractor!==identity.officialName)return Response.json({error:"Official names are managed through company identity, not timesheet editing."},{status:400})
    }
    if(current.payoutEligible)return Response.json({error:"Business accounts has authorized eligibility; this evidence is locked."},{status:409})
    if(access.role==="manager"&&current.ownerEmail?.toLowerCase()!==access.email.toLowerCase()&&hasEntryFieldPatch(patch)&&!scope.reviewable)return Response.json({error:"Review assistance rights are required to change this evidence."},{status:403})
    if(patch.reviewManagerEmail!==undefined){
      if(patch.status!=="submitted"||current.ownerEmail?.toLowerCase()!==access.email.toLowerCase())return Response.json({error:"A manager can only be selected when submitting your own work."},{status:403})
    }
    if(patch.status==="submitted"&&(access.role==="contractor"||access.role==="employee")){
      if(current.ownerEmail?.toLowerCase()!==access.email.toLowerCase())return Response.json({error:"Only the account owner can route a personal timesheet for review."},{status:403})
      const reviewer=await resolveSubmissionReviewer(access.email)
      if(!reviewer)return Response.json({error:"No active manager currently has both team-view and approval rights. Ask an administrator to assign a reviewer before submitting."},{status:400})
      if(patch.reviewManagerEmail&&patch.reviewManagerEmail.toLowerCase()!==reviewer.email)return Response.json({error:"Reviewing manager is assigned by the company and cannot be changed during submission."},{status:403})
      patch={...patch,reviewManagerEmail:reviewer.email}
    }

    if (patch.status === "approved" || patch.status === "rejected") {
      if(current.ownerEmail?.toLowerCase()===access.email.toLowerCase())return Response.json({error:"Your own entries require another authorized reviewer."},{status:403})
      if(!scope.reviewable)return Response.json({error:"An explicit independent-review right or active scoped request is required."},{status:403})
      if(hasEntryFieldPatch(patch))return Response.json({error:"Review decisions cannot change submitted evidence."},{status:400})
    }

    if (
      (!access.canReview || current.ownerEmail?.toLowerCase()===access.email.toLowerCase()) &&
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
      access.canReview && current.ownerEmail?.toLowerCase()!==access.email.toLowerCase(),
      patch.reviewNote,
    )
    if (statusError) {
      return Response.json(
        { error: statusError },
        { status: statusError.includes("permission") ? 403 : 400 },
      )
    }

    if(patch.status==="approved"){
      if(access.role!=="account_manager"&&!access.permissions.send_to_accounts)return Response.json({error:"Approval requires permission to forward evidence to business accounts."},{status:403})
      const ownerIdentity=current.ownerEmail?(await listAccountIdentities([current.ownerEmail]))[0]:null
      if(!ownerIdentity)return Response.json({error:"Only a registered account can be approved into the business-accounts workflow."},{status:409})
      const ownerRole=current.ownerEmail?await getEffectiveUserRole(current.ownerEmail):null
      const revision=patch.expectedRevision??current.revision
      if(!revision)return Response.json({error:"Refresh this entry before approving."},{status:409})
      const forwarded=await approveAndForward(id,access.email,revision,ownerRole??"contractor",getAuditContext(req))
      if(!forwarded)return Response.json({error:"Evidence changed. Refresh before approving."},{status:409})
      return Response.json({entry:forwarded})
    }
    const revision=patch.expectedRevision??current.revision
    if(!revision)return Response.json({error:"Refresh this timesheet before saving a status or editing it."},{status:409})
    if(patch.status==="submitted"){
      const submissionDeadline=await getTimesheetSubmissionDeadline()
      if(submissionDeadline&&Date.now()>=Date.parse(submissionDeadline))return Response.json({error:`The organization submission deadline passed on ${new Date(submissionDeadline).toLocaleString()}. Contact an administrator if an exception is needed.`},{status:409})
      const submitted=await submitTimeEntryWithAudit(
        access.email,
        id,
        patch as typeof patch & {status:"submitted"},
        access.includeAll,
        access.canReview ? access.email : undefined,
        revision,
        access.email,
        current.status,
        changedFieldMetadata(patch),
        access.role,
        getAuditContext(req),
      )
      if(!submitted){
        const latestDeadline=await getTimesheetSubmissionDeadline()
        if(latestDeadline&&Date.now()>=Date.parse(latestDeadline))return Response.json({error:`The organization submission deadline passed on ${new Date(latestDeadline).toLocaleString()}. Contact an administrator if an exception is needed.`},{status:409})
        return Response.json({error:"Evidence changed. Refresh before submitting again."},{status:409})
      }
      return Response.json({entry:submitted})
    }
    if(patch.status==="rejected"){
      const rejected=await rejectSubmittedEntry(id,access.email,revision,patch.reviewNote!.trim(),getAuditContext(req))
      if(!rejected)return Response.json({error:"Evidence changed or was already reviewed. Refresh before rejecting."},{status:409})
      return Response.json({entry:rejected})
    }
    const entry = await updateTimeEntryWithAudit(
      access.email,
      id,
      patch,
      access.includeAll,
      access.canReview ? access.email : undefined,
      revision,
      {
        actorEmail: access.email,
        action: patch.status ? auditActionForStatus(patch.status) : "entry_updated",
        metadata: {
          fromStatus: current.status,
          toStatus: patch.status ?? current.status,
          ...changedFieldMetadata(patch),
        },
        context: getAuditContext(req),
      },
    )

    if (!entry) {
      if(patch.expectedRevision)return Response.json({error:"Evidence changed. Refresh before recording this decision."},{status:409})
      return Response.json({ error: "Entry not found." }, { status: 404 })
    }

    return Response.json({ entry })
  } catch (err) {
    if(err instanceof z.ZodError||err instanceof SyntaxError)return Response.json({error:"Invalid entry update. Check the selected fields and rejection reason."},{status:400})
    const reference=crypto.randomUUID()
    const databaseCode=err&&typeof err==="object"&&"code" in err&&typeof err.code==="string"&&/^[A-Z0-9]{5}$/.test(err.code)?err.code:"unavailable"
    console.error("[entries] update failed",{reference,databaseCode})
    return Response.json(
      { error: "The update could not be confirmed. Refresh before retrying; the server may have saved it.",reference },
      { status: 503 },
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

    const scope = await createReviewAccess(access.email, access)(current)
    if(!scope.visible)return Response.json({error:"Entry not found."},{status:404})
    if(current.payoutEligible)return Response.json({error:"Authorized eligibility evidence cannot be deleted."},{status:409})
    if(access.role==="manager"&&current.ownerEmail?.toLowerCase()!==access.email.toLowerCase())return Response.json({error:"Managers cannot delete another person's timesheet. Reject it with a reason to return it for correction."},{status:403})
    if (
      (!access.canReview || current.ownerEmail?.toLowerCase()===access.email.toLowerCase()) &&
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
