/**
 * Resolves entry visibility and independent-review authority from live rights.
 * Managers see their own work plus permitted submitted evidence, never others' drafts.
 * Request-based assistance is scoped to a revision and expires with grantor authority.
 */
import "server-only"
import { getEffectiveUserRole } from "./access"
import { getEffectivePermissions } from "./effective-permissions"
import { listReviewRequests } from "./review-requests"
import { canReviewRole } from "./review-policy"
import type { Permissions } from "./permissions"
import type { TimeEntry, UserRole } from "./types"
export type ReviewActor = { role: UserRole | null; permissions: Permissions }

/**
 * Resolves direct rights without using delegated request grants.
 * @param entry - Server-loaded evidence with owner and optional assigned manager.
 * @param email - Authenticated actor identity.
 * @param access - Current effective role and explicit rights.
 * @param ownerRole - Server-resolved effective role of the evidence owner.
 * @returns Visibility and decision eligibility, always excluding self-review.
 */
export function directReviewAccess(entry: TimeEntry, email: string, access: ReviewActor, ownerRole: UserRole | null) {
  const own = entry.ownerEmail?.toLowerCase() === email.toLowerCase()
  if (own) return { visible: true, reviewable: false }
  const { role, permissions: rights } = access
  const otherManager = !!entry.reviewManagerEmail && entry.reviewManagerEmail.toLowerCase() !== email.toLowerCase()
  let visible = !!rights.view_team
  if (role === "manager") visible = entry.status === "submitted" && (ownerRole === "manager" ? rights.view_manager_entries : (rights.view_team && (!otherManager || rights.view_other_manager_entries)))
  if (role === "account_manager") visible = entry.status === "submitted" && (
    (ownerRole === "manager" && rights.view_manager_entries) ||
    ((ownerRole === "employee" || ownerRole === "contractor") && rights.review_entries && entry.reviewManagerEmail?.toLowerCase() === email.toLowerCase())
  )
  const decisionRight = ownerRole === "manager" ? rights.review_manager_entries : rights.review_entries
  const laneRight = role !== "manager" || ownerRole === "manager" || !otherManager || rights.review_other_manager_entries
  return { visible, reviewable: visible && entry.status === "submitted" && decisionRight && laneRight && canReviewRole(role, ownerRole, rights) }
}

/**
 * Creates a request-local resolver with cached owner roles and lazy scoped grants.
 * @param email - Authenticated actor identity.
 * @param access - Live role/rights; no values are accepted from request bodies.
 * @returns Async resolver for each server-loaded entry's visibility and review rights.
 */
export function createReviewAccess(email: string, access: ReviewActor) {
  const owners = new Map<string, Promise<UserRole | null>>()
  let grants: ReturnType<typeof listReviewRequests> | undefined
  const grantors = new Map<string, ReturnType<typeof getEffectivePermissions>>()
  return async (entry: TimeEntry) => {
    const owner = entry.ownerEmail?.toLowerCase()
    if (owner && !owners.has(owner)) owners.set(owner, getEffectiveUserRole(owner))
    const ownerRole = owner ? await owners.get(owner)! : null
    const direct = directReviewAccess(entry, email, access, ownerRole)
    if (direct.reviewable || entry.status !== "submitted" || owner === email.toLowerCase() || access.role !== "manager" || !access.permissions.accept_review_requests || !access.permissions.review_entries) return direct
    grants ??= listReviewRequests(email)
    for (const grant of await grants) {
      if (grant.entry_id !== entry.id || grant.source_revision !== entry.revision) continue
      if (!grantors.has(grant.sender_email)) grantors.set(grant.sender_email, getEffectivePermissions(grant.sender_email))
      const authority = await grantors.get(grant.sender_email)!
      if (!authority.permissions.request_review_help || !authority.permissions.delegate_permissions || !["manager", "admin"].includes(authority.role ?? "")) continue
      const source = directReviewAccess(entry, grant.sender_email, authority, ownerRole)
      if (source.reviewable || (owner === grant.sender_email.toLowerCase() && ownerRole === "manager")) return { visible: true, reviewable: true }
    }
    return direct
  }
}
