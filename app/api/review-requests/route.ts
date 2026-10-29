/**
 * Creates scoped reviewer assistance and an encrypted high-priority notice together.
 * Managers may request help for permitted submitted evidence, including their own
 * personal time, but never grant global rights or allow a recipient to self-approve.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { actorRoster } from "@/lib/collaboration"
import { getTimeEntry, recordAuditEvent } from "@/lib/db"
import { directReviewAccess } from "@/lib/review-access"
import { createReviewRequests, listReviewRequests } from "@/lib/review-requests"
import { encryptedMessageSchema, validateEnvelope } from "@/lib/message-envelope"
import { getAuditContext } from "@/lib/audit"
import { withOperationalCapture } from "@/lib/api-outcome-capture"

/** @returns Promise<Response> with active reviewer choices and the caller's own grants. */
async function getReviewRequests(): Promise<Response> {
  try {
    const email = (await auth())?.user?.email, access = await getEffectivePermissions(email)
    if (!email || !["manager", "admin"].includes(access.role ?? "")) return Response.json({ error: "Forbidden." }, { status: 403 })
    const reviewers = []
    if(access.permissions.request_review_help && access.permissions.delegate_permissions && access.permissions.send_messages) {
      for (const actor of await actorRoster()) {
        if (actor.email.toLowerCase() === email.toLowerCase() || actor.role !== "manager" || actor.accessStatus !== "active") continue
        const rights = (await getEffectivePermissions(actor.email)).permissions
        if (rights.accept_review_requests && rights.review_entries) reviewers.push({ email: actor.email, displayName: actor.displayName })
      }
    }
    return Response.json({ reviewers, requests: access.role === "manager" && access.permissions.accept_review_requests ? await listReviewRequests(email) : [] }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "Reviewer requests unavailable." }, { status: 503 }) }
}

/**
 * Validates direct delegation authority and atomically stores the encrypted request.
 * @param request - Selected IDs/revisions, active recipient, message UUID and ciphertext.
 * @returns Promise<Response> with the number of grants, or a non-mutating failure.
 */
async function createReviewRequest(request: Request): Promise<Response> {
  try {
    const email = (await auth())?.user?.email, access = await getEffectivePermissions(email)
    if (!email || !["manager", "admin"].includes(access.role ?? "") || !access.permissions.request_review_help || !access.permissions.delegate_permissions || !access.permissions.send_messages) return Response.json({ error: "Review-delegation and messaging rights are required." }, { status: 403 })
    const input = z.object({ selection: z.array(z.object({ id: z.string().uuid(), revision: z.string().min(1).max(100) })).min(1).max(50), recipient: z.string().email(), messageId: z.string().uuid(), encrypted: encryptedMessageSchema }).parse(await request.json())
    if(new Set(input.selection.map(row=>row.id)).size!==input.selection.length)return Response.json({error:"Select each entry once."},{status:400})
    const recipient = await getEffectivePermissions(input.recipient)
    if (recipient.role !== "manager" || !recipient.permissions.accept_review_requests || !recipient.permissions.review_entries || input.recipient.toLowerCase() === email.toLowerCase()) return Response.json({ error: "Choose another active manager who accepts reviewer requests." }, { status: 403 })
    for (const selected of input.selection) {
      const entry = await getTimeEntry(email, selected.id, true)
      if (!entry || entry.status !== "submitted" || entry.revision !== selected.revision || entry.ownerEmail?.toLowerCase() === input.recipient.toLowerCase()) return Response.json({ error: "Evidence changed or the selected reviewer owns it." }, { status: 409 })
      const ownerRole = entry.ownerEmail ? await getEffectiveUserRole(entry.ownerEmail) : null
      const direct = directReviewAccess(entry, email, access, ownerRole)
      if (!direct.reviewable && !(entry.ownerEmail?.toLowerCase() === email.toLowerCase() && access.role === "manager")) return Response.json({ error: "You cannot delegate review of this timesheet." }, { status: 403 })
    }
    if (!await validateEnvelope(input.encrypted, email, email, input.recipient, [email, input.recipient])) return Response.json({ error: "Both participants must have enrolled secure messaging devices. No request was granted or sent." }, { status: 400 })
    const count = await createReviewRequests(input.selection, email, input.recipient, input.messageId, input.encrypted)
    if (count !== input.selection.length) return Response.json({ error: "Evidence changed or this request was already recorded. Refresh before retrying." }, { status: 409 })
    await recordAuditEvent({ actorEmail: email, action: "entry_review_requested", targetType: "review_request", targetId: input.messageId, metadata: { count, recipient: input.recipient.toLowerCase(), priority: "high", expiresInHours: 48 }, ...getAuditContext(request) })
    return Response.json({ count, messageId: input.messageId, expiresInHours: 48 }, { status: 201 })
  } catch (error) { return Response.json({ error: error instanceof z.ZodError || error instanceof SyntaxError ? "Invalid reviewer request." : "Reviewer request could not be confirmed. Refresh before retrying." }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 }) }
}

export const GET=withOperationalCapture("/api/review-requests","GET",getReviewRequests)
export const POST=withOperationalCapture("/api/review-requests","POST",createReviewRequest)
