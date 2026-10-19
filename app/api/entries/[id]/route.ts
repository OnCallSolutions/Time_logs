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
import { decideTimesheetBatch } from "@/lib/account-handoffs"
import { listAccountIdentities } from "@/lib/account-identities"
import { resolveSubmissionReviewer } from "@/lib/submission-reviewer"
import { persistenceFailureDetails } from "@/lib/persistence-diagnostics"
import {
  auditActionForStatus,
  changedFieldMetadata,
  getAuditContext,
} from "@/lib/audit"
import {
  deleteTimeEntry,
  getTimeEntry,
  recordAuditEvent,
  updateTimeEntryWithAudit,
  submitTimeEntryWithAudit,
  getTimesheetSubmissionDeadline,
  listTimeProjects,
  isTimesheetDateArchived,
  hasActiveTimesheetExtension,
  listTimeEntries,
  listTimesheetPeriods,
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
    correctionDueAt: z.string().datetime({offset:true}).optional(),
    expectedRevision: z.string().min(1).max(100).optional(),
    reviewManagerEmail: z.string().email().nullable().optional(),
    batchEntries:z.array(z.object({id:z.string().uuid(),revision:z.string().min(1).max(100)}).strict()).min(1).max(100).optional(),
  })
  .refine((patch) => Object.keys(patch).some(key=>key!=="expectedRevision"&&key!=="batchEntries"), {
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
    if(current.correctionOwnerEmail&&access.role!=="admin"&&current.correctionOwnerEmail.toLowerCase()!==access.email.toLowerCase())return Response.json({error:"Only the designated correction owner may edit or resubmit this returned timesheet."},{status:403})
    if(current.correctionDueAt&&Date.now()>Date.parse(current.correctionDueAt)&&access.role!=="admin")return Response.json({error:`The correction window closed on ${new Date(current.correctionDueAt).toLocaleString()}. Contact an administrator if further changes are required.`},{status:409})
    const correctionWindowOpen=!!current.correctionOwnerEmail&&current.correctionOwnerEmail.toLowerCase()===access.email.toLowerCase()&&!!current.correctionDueAt&&Date.now()<=Date.parse(current.correctionDueAt)
    if((access.role==="contractor"||access.role==="employee")&&!correctionWindowOpen&&await isTimesheetDateArchived(current.date)){
      const extensionSubmission=patch.status==="submitted"&&!hasEntryFieldPatch(patch)&&await hasActiveTimesheetExtension(current.ownerEmail??access.email,current.date)
      if(!extensionSubmission)return Response.json({error:"Past timesheet periods are archived and read-only. An approved extension only permits submitting existing draft entries."},{status:409})
    }
    if(patch.project!==undefined&&(access.role==="contractor"||access.role==="employee")){
      const assigned=await listTimeProjects(false,access.email)
      if(!assigned.some(project=>project.name.toLocaleLowerCase()===patch.project!.toLocaleLowerCase()))return Response.json({error:"That project is not assigned to your account. Ask your manager to assign it before changing this entry."},{status:422})
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
    if(patch.status==="submitted"){
      if((access.role==="contractor"||access.role==="employee")&&current.ownerEmail?.toLowerCase()!==access.email.toLowerCase())return Response.json({error:"Only the account owner can route a personal timesheet for review."},{status:403})
      const submitterEmail=current.ownerEmail??access.email
      const selfAccountManager=current.ownerEmail?.toLowerCase()===access.email.toLowerCase()&&access.role==="account_manager"
      const reviewer=selfAccountManager?{email:access.email}:await resolveSubmissionReviewer(submitterEmail)
      if(!reviewer)return Response.json({error:"No active manager currently has both team-view and approval rights. Ask an administrator to assign a reviewer before submitting."},{status:400})
      if(patch.reviewManagerEmail&&patch.reviewManagerEmail.toLowerCase()!==reviewer.email)return Response.json({error:"Reviewing manager is assigned by the company and cannot be changed during submission."},{status:403})
      patch={...patch,reviewManagerEmail:reviewer.email}
    }

    const selfAccountManagerApproval=access.role==="account_manager"&&current.ownerEmail?.toLowerCase()===access.email.toLowerCase()&&patch.status==="approved"
    if (patch.status === "approved" || patch.status === "rejected") {
      if(current.ownerEmail?.toLowerCase()===access.email.toLowerCase()&&!selfAccountManagerApproval)return Response.json({error:"You may self-approve business account manager entries, but cannot reject your own entries."},{status:403})
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
      access.canReview && (current.ownerEmail?.toLowerCase()!==access.email.toLowerCase()||selfAccountManagerApproval),
      patch.reviewNote,
    )
    if (statusError) {
      return Response.json(
        { error: statusError },
        { status: statusError.includes("permission") ? 403 : 400 },
      )
    }

    if(patch.status==="approved"||patch.status==="rejected"){
      if(patch.expectedRevision&&patch.expectedRevision!==current.revision)return Response.json({error:"Evidence changed. Refresh the complete timesheet before deciding."},{status:409})
      if(!current.ownerEmail)return Response.json({error:"Timesheet owner is unavailable."},{status:409})
      if(patch.status==="approved"&&!selfAccountManagerApproval&&access.role!=="account_manager"&&!access.permissions.send_to_accounts)return Response.json({error:"Approval requires permission to forward evidence to business accounts."},{status:403})
      const periods=await listTimesheetPeriods()
      const period=periods.find(item=>current.date>=item.startDate&&current.date<=item.endDate)
      const [year,month]=current.date.slice(0,7).split("-").map(Number)
      const startDate=period?.startDate??`${current.date.slice(0,7)}-01`
      const endDate=period?.endDate??new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)
      const visibleEntries=await listTimeEntries(access.email,access.includeAll)
      const batch=visibleEntries.filter(entry=>entry.status==="submitted"&&entry.ownerEmail?.toLowerCase()===current.ownerEmail!.toLowerCase()&&entry.date>=startDate&&entry.date<=endDate)
      if(!batch.some(entry=>entry.id===id))return Response.json({error:"The selected entry is not in an awaiting timesheet."},{status:409})
      const batchScopes=await Promise.all(batch.map(entry=>createReviewAccess(access.email,access)(entry)))
      if(batchScopes.some(item=>!item.visible||!item.reviewable))return Response.json({error:"Every entry in this timesheet must be in your review scope before deciding the batch."},{status:403})
      const selection=batch.map(entry=>({id:entry.id,revision:entry.revision??""}))
      if(selection.some(item=>!item.revision))return Response.json({error:"Refresh the timesheet before reviewing it."},{status:409})
      if(patch.batchEntries){
        const supplied=new Map(patch.batchEntries.map(item=>[item.id,item.revision]))
        if(supplied.size!==selection.length||selection.some(item=>supplied.get(item.id)!==item.revision))return Response.json({error:"The timesheet changed. Refresh the complete timesheet before deciding."},{status:409})
      }
      if(patch.status==="rejected"&&!patch.reviewNote?.trim())return Response.json({error:"A rejection reason is required."},{status:400})
      let correctionDueAt:string|undefined
      if(patch.status==="rejected"){
        if(!patch.correctionDueAt)return Response.json({error:"Choose a correction deadline before returning this timesheet."},{status:400})
        const periodDeadline=period?.exceptionResolutionDeadline??period?.accountApprovalDeadline??period?.submissionDeadline
        const due=Date.parse(patch.correctionDueAt)
        if(!periodDeadline||!Number.isFinite(due)||due<=Date.now()||due>Date.parse(periodDeadline))return Response.json({error:"Correction deadlines must be in the future and no later than the configured period resolution deadline."},{status:422})
        correctionDueAt=new Date(due).toISOString()
      }
      if(patch.status==="approved"&&!selfAccountManagerApproval&&!((await listAccountIdentities([current.ownerEmail]))[0]))return Response.json({error:"Only a registered account can be approved into the business-accounts workflow."},{status:409})
      const ownerRole=await getEffectiveUserRole(current.ownerEmail)
      const updated=await decideTimesheetBatch({ownerEmail:current.ownerEmail,startDate,endDate,selection,rejectedEntryId:patch.status==="rejected"?id:undefined,correctionDueAt},access.email,patch.status,ownerRole??"contractor",access.role==="account_manager",patch.reviewNote?.trim()??"",getAuditContext(req))
      if(updated.length!==selection.length)return Response.json({error:"The timesheet changed while it was being reviewed. Refresh before deciding."},{status:409})
      return Response.json({entry:updated.find(entry=>entry.id===id),entries:updated})
    }
    const revision=patch.expectedRevision??current.revision
    if(!revision)return Response.json({error:"Refresh this timesheet before saving a status or editing it."},{status:409})
    if(patch.status==="submitted"){
      const submissionDeadline=await getTimesheetSubmissionDeadline()
      const hasExtension=await hasActiveTimesheetExtension(current.ownerEmail??access.email,current.date)
      if(submissionDeadline&&Date.now()>=Date.parse(submissionDeadline)&&!hasExtension)return Response.json({error:`The submission deadline passed on ${new Date(submissionDeadline).toLocaleString()}. Request an extension from your account manager.`},{status:409})
      let submitted: TimeEntry | null
      try {
        submitted=await submitTimeEntryWithAudit(
          access.email,
          id,
          patch as typeof patch & {status:"submitted";reviewManagerEmail:string},
          access.includeAll,
          access.canReview ? access.email : undefined,
          revision,
          access.email,
          current.status,
          changedFieldMetadata(patch),
          access.role,
          getAuditContext(req),
        )
      } catch (writeError) {
        // A transport can fail after PostgreSQL commits. Confirm the durable state
        // before telling the user to retry an operation that may already have saved.
        try {
          const persisted=await getTimeEntry(access.email,id,access.includeAll)
          const expectedReviewer=patch.reviewManagerEmail!
          const requestedFieldsPersisted=(patch.contractor===undefined||persisted?.contractor===patch.contractor)&&
            (patch.date===undefined||persisted?.date.slice(0,10)===patch.date)&&
            (patch.hours===undefined||persisted?.hours===patch.hours)&&
            (patch.project===undefined||persisted?.project===patch.project)&&
            (patch.description===undefined||persisted?.description===patch.description)
          if(persisted?.status==="submitted"&&persisted.ownerEmail?.toLowerCase()===current.ownerEmail?.toLowerCase()&&
            requestedFieldsPersisted&&
            persisted.reviewManagerEmail?.toLowerCase()===expectedReviewer.toLowerCase()){
            console.warn("[entries] submission confirmed after persistence error",{id,...persistenceFailureDetails(writeError)})
            return Response.json({entry:persisted})
          }
        } catch (readError) {
          console.warn("[entries] submission read-back failed",{id,...persistenceFailureDetails(readError)})
        }
        throw writeError
      }
      if(!submitted){
        const latestDeadline=await getTimesheetSubmissionDeadline()
        const hasLatestExtension=await hasActiveTimesheetExtension(current.ownerEmail??access.email,current.date)
        if(latestDeadline&&Date.now()>=Date.parse(latestDeadline)&&!hasLatestExtension)return Response.json({error:`The submission deadline passed on ${new Date(latestDeadline).toLocaleString()}. Request an extension from your account manager.`},{status:409})
        return Response.json({error:"Evidence changed. Refresh before submitting again."},{status:409})
      }
      return Response.json({entry:submitted})
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
      selfAccountManagerApproval,
    )

    if (!entry) {
      if(patch.expectedRevision)return Response.json({error:"Evidence changed. Refresh before recording this decision."},{status:409})
      return Response.json({ error: "Entry not found." }, { status: 404 })
    }

    return Response.json({ entry })
  } catch (err) {
    if(err instanceof z.ZodError||err instanceof SyntaxError)return Response.json({error:"Invalid entry update. Check the selected fields and rejection reason."},{status:400})
    const reference=crypto.randomUUID()
    const diagnostics=persistenceFailureDetails(err)
    console.error("[entries] update failed",{reference,...diagnostics})
    return Response.json(
      { error: "The update could not be confirmed. Refresh before retrying; the server may have saved it.",reference,code:diagnostics.databaseCode },
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
    if(current.correctionOwnerEmail&&access.role!=="admin"&&current.correctionOwnerEmail.toLowerCase()!==access.email.toLowerCase())return Response.json({error:"Only the designated correction owner may delete this returned timesheet."},{status:403})
    if(current.correctionDueAt&&Date.now()>Date.parse(current.correctionDueAt)&&access.role!=="admin")return Response.json({error:`The correction window closed on ${new Date(current.correctionDueAt).toLocaleString()}. Contact an administrator if further changes are required.`},{status:409})
    const correctionWindowOpen=!!current.correctionOwnerEmail&&current.correctionOwnerEmail.toLowerCase()===access.email.toLowerCase()&&!!current.correctionDueAt&&Date.now()<=Date.parse(current.correctionDueAt)
    if((access.role==="contractor"||access.role==="employee")&&!correctionWindowOpen&&await isTimesheetDateArchived(current.date))return Response.json({error:"Past timesheet periods are archived and read-only. Contact your manager if a correction is required."},{status:409})

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
