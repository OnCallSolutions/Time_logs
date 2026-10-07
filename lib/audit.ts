/**
 * Provides helpers for request-scoped security audit metadata.
 *
 * Routes use this module to capture consistent request context without exposing
 * raw parsing logic across handlers. The helpers intentionally keep metadata
 * compact so audit records remain useful without collecting unnecessary data.
 */
import "server-only"

import type { AuditAction } from "@/lib/db"

export type AuditContext = {
  ipAddress: string | null
  userAgent: string | null
}

/**
 * Extracts audit context from a request.
 *
 * Vercel and proxies may supply forwarded IP headers. The first forwarded value
 * is stored as the most likely client IP, while the user-agent is recorded for
 * administrative investigation.
 *
 * @param req - Incoming route request.
 * @returns Request context suitable for audit event metadata.
 */
export function getAuditContext(req: Request): AuditContext {
  const forwardedFor = req.headers.get("x-forwarded-for")
  const realIp = req.headers.get("x-real-ip")
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || realIp || null

  return {
    ipAddress,
    userAgent: req.headers.get("user-agent"),
  }
}

/**
 * Resolves the audit action name for a status transition.
 *
 * Status workflow events deserve more precise audit labels than a generic update,
 * which makes the security timeline easier to scan.
 *
 * @param status - New status applied to an entry.
 * @returns Audit action matching the workflow transition.
 */
export function auditActionForStatus(status: string): AuditAction {
  if (status === "submitted") return "entry_submitted"
  if (status === "draft") return "entry_recalled"
  if (status === "approved") return "entry_approved"
  if (status === "rejected") return "entry_rejected"
  return "entry_updated"
}

/**
 * Builds compact metadata describing changed fields.
 *
 * Field values are deliberately omitted so the audit table records what changed
 * without duplicating potentially sensitive descriptions or profile image data.
 *
 * @param patch - Object containing fields submitted in an update request.
 * @returns Metadata object listing changed field names.
 */
export function changedFieldMetadata(patch: Record<string, unknown>) {
  return {
    changedFields: Object.keys(patch).filter(
      (key) => patch[key] !== undefined && key !== "reviewNote",
    ),
    hasReviewNote: typeof patch.reviewNote === "string",
  }
}
